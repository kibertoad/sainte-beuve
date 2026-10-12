import type {
  AttentionEvent,
  AttentionEventKind,
  AttentionRequest,
  CreateAttentionRequest,
  CreateReviewCommitment,
  PullRequestRef,
  Reviewer,
  ReviewCommitment,
} from '@sainte-beuve/contracts'
import { recipientShortfall } from '@sainte-beuve/contracts'
import { ConflictError, ForbiddenError, ValidationError, assertFound } from '@sainte-beuve/kernel'
import {
  type AttentionChange,
  askMoreChange,
  audienceRuleOf,
  cancelChange,
  commitmentChange,
  declineChange,
  declineRefusal,
  distinctAsSpelled,
  hasDeclined,
  isInAttentionAudience,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import {
  requestCommittedReviewer,
  withdrawCommittedReviewer,
} from '../../integrations/reviewRequests.js'
import { refreshAskDeliveries, sendAskDms, tellRequesterShort } from './askDeliveries.js'
import { changeAsk } from './changeAsk.js'
import { addressAsk, namedAdditions, rankedCandidates } from './recipients.js'

/**
 * Asking a team to look at something, and answering the ask.
 *
 * The service owns the WRITES and the ordering; who an ask reaches and when it
 * is answered are decisions in `@sainte-beuve/reviewers`, so the same rule
 * serves the live stream, the REST inbox and this file rather than three
 * copies that can disagree about who was pinged.
 *
 * Every write publishes, and publishing is the LAST thing it does. The store is
 * what the next reader polls, so an event that went out before the row landed
 * would tell a page about a request the page cannot then fetch.
 */
export class AttentionService {
  constructor(private readonly container: AppContainer) {}

  /**
   * What is still open and concerns this person: the asks addressed to them,
   * plus the ones they raised. Their own are included because a requester has
   * to be able to watch their ask fill up and disappear, and a screen that hid
   * it would leave them refreshing the pull request to find out.
   */
  async inbox(viewer: Reviewer): Promise<AttentionRequest[]> {
    const open = await this.container.repositories.attention.list({ status: ['open'] })
    return open.filter((request) => concerns(request, viewer))
  }

  async raise(viewer: Reviewer, input: CreateAttentionRequest): Promise<AttentionRequest> {
    const { repositories, clock, ids } = this.container
    const { named, wanted } = await addressAsk(this.container, viewer, input)
    const recipients = named.map((reviewer) => ({
      reviewerId: reviewer.id,
      displayName: reviewer.displayName,
    }))
    const now = clock.now()
    const request = await repositories.attention.create({
      id: ids.next(),
      pullRequest: input.pullRequest,
      title: input.title,
      requestedById: viewer.id,
      requestedByName: viewer.displayName,
      recipients,
      requiredSkills: distinctAsSpelled(wanted.skills),
      domains: distinctAsSpelled(wanted.domains),
      sameTeamOnly: input.sameTeamOnly,
      // The requester's team is captured HERE rather than read at delivery
      // time, so somebody changing team does not silently re-address an ask
      // that is already out.
      team: viewer.team,
      neededCommitments: input.neededCommitments,
      commitments: [],
      note: input.note,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      chatDeliveries: [],
      declines: [],
      // Asking on means asking the next named person, which an ask sent by
      // fit has no use for: it already reaches everybody who matches.
      keepAsking: input.keepAsking && recipients.length > 0,
      people: input.people,
    })
    this.publish('opened', request)
    return sendAskDms(this.container, request, named)
  }

  /**
   * "I will review it."
   *
   * Open to anybody the ask did NOT come from, and not only to the audience the
   * gate produced. Volunteering is a judgement somebody made about their own
   * competence, and a skill list is not in a position to overrule it; the gate
   * decides who gets ASKED, which is a different question.
   * `ReviewService.claim` makes the same call for the board's own take button.
   *
   * The requester is the one exception, and it is not a formality: their own
   * commitment would count towards the critical mass and resolve the ask, so a
   * misplaced click would withdraw it from everybody's inbox and leave the
   * pull request with the reviewer it started with, which is nobody.
   */
  async commit(viewer: Reviewer, attentionId: string): Promise<AttentionRequest> {
    const request = await this.require(attentionId)
    if (request.requestedById === viewer.id) {
      throw new ForbiddenError('You asked for this review, so you cannot be the one to take it')
    }
    // Their OWN commitment is answered before the status is, and the order is
    // the whole point: with the default critical mass of one, the click that
    // resolved the ask makes the next click from the same person a click on a
    // resolved ask. Refusing it would toast "could not commit" at the one
    // person who did, over a re-render or a restored tab.
    if (request.commitments.some((entry) => entry.reviewerId === viewer.id)) return request
    if (request.status !== 'open') {
      throw new ConflictError(`This request is already ${request.status}`, { attentionId })
    }

    const commitment = {
      reviewerId: viewer.id,
      displayName: viewer.displayName,
      committedAt: this.container.clock.now(),
    }
    // The commitment row FIRST, then the ask, then the event. Both writes are
    // needed and there is no transaction across them, so the order decides what
    // a failure between them leaves behind: this way a refused second write
    // leaves the ask open with a commitment nobody lost, and the retry finds
    // that row and is a no-op. The other way round resolves the ask, drops the
    // promise, and tells nobody.
    await this.recordCommitment(viewer, request.pullRequest, request.title, attentionId)
    // Read off the change as the store last ran it: a commitment of theirs that
    // landed in between writes nothing, and only the one that completes the
    // ask resolves it.
    const { request: updated, patch } = await changeAsk(this.container, attentionId, (stored) =>
      commitmentChange(stored, commitment),
    )
    if (patch === null) return updated
    const resolved = patch.status === 'resolved'
    this.publish(resolved ? 'resolved' : 'committed', updated)
    await refreshAskDeliveries(this.container, updated, resolved ? null : viewer.id)
    return updated
  }

  /**
   * "Not me." Open to anybody the ask reached, named or through the gate, and
   * to somebody declining again with a new reason. The ask leaves their inbox
   * and their DM says so. A named ask the decline leaves short asks the next
   * best match by itself when the requester chose that; otherwise the
   * requester sees the shortfall and asks on through `askMore`.
   */
  async decline(
    viewer: Reviewer,
    attentionId: string,
    reason: string | null,
  ): Promise<AttentionRequest> {
    const request = await this.require(attentionId)
    refuseDecline(request, viewer)
    const decline = {
      reviewerId: viewer.id,
      displayName: viewer.displayName,
      reason,
      declinedAt: this.container.clock.now(),
    }
    // Ranked whenever the ask keeps asking, not only when this read shows it
    // short: a decline landing alongside this one can leave it short by the
    // time the change is worked out against the stored ask.
    const candidates = request.keepAsking ? await rankedCandidates(this.container, request) : []
    // Refused again on the ask as stored: it may have closed, or they may have
    // committed in another tab, since it was read above.
    const updated = await this.applyChange(attentionId, (stored) => {
      refuseDecline(stored, viewer)
      return declineChange(stored, decline, candidates)
    })
    this.publish('declined', updated.request)
    await refreshAskDeliveries(this.container, updated.request, viewer.id)
    await tellRequesterShort(this.container, request, updated.request)
    return sendAskDms(this.container, updated.request, updated.asked)
  }

  /**
   * The requester asking more people on a named ask: the ones they name, or
   * else the next best matches, as many as the ask is short and at least one.
   * An ask sent by fit already reaches everybody who matches, and naming
   * people on it would narrow it to them, so that is refused.
   */
  async askMore(
    viewer: Reviewer,
    attentionId: string,
    recipientIds: readonly string[],
  ): Promise<AttentionRequest> {
    const request = await this.requireOpen(attentionId)
    if (request.requestedById !== viewer.id) {
      throw new ForbiddenError('Only the person who asked for attention can ask more people')
    }
    if (request.recipients.length === 0) {
      throw new ValidationError(
        'This ask goes to everybody who fits it, so there is nobody to add',
        { attentionId },
      )
    }
    const named = recipientIds.length > 0
    const candidates = named
      ? await namedAdditions(this.container, request, recipientIds)
      : await rankedCandidates(this.container, request)
    // Everybody named was asked already: a repeated click, answered as it stands.
    if (named && candidates.length === 0) return request
    const now = this.container.clock.now()
    const count = (ask: AttentionRequest) =>
      named ? candidates.length : Math.max(1, recipientShortfall(ask))
    if (askMoreChange(request, candidates, count(request), now).asked.length === 0) {
      throw new ConflictError('Nobody else is available to ask', { attentionId })
    }
    const updated = await this.applyChange(attentionId, (stored) => {
      refuseClosed(stored)
      return askMoreChange(stored, candidates, count(stored), now)
    })
    this.publish('asked', updated.request)
    return sendAskDms(this.container, updated.request, updated.asked)
  }

  /** The requester withdrawing. Nobody else can: it is their ask to end. */
  async cancel(viewer: Reviewer, attentionId: string): Promise<AttentionRequest> {
    const request = await this.require(attentionId)
    if (request.requestedById !== viewer.id) {
      throw new ForbiddenError('Only the person who asked for attention can withdraw the request')
    }
    if (request.status !== 'open') return request
    const now = this.container.clock.now()
    const { request: updated, patch } = await changeAsk(this.container, attentionId, (stored) =>
      cancelChange(stored, now),
    )
    if (patch === null) return updated
    this.publish('cancelled', updated)
    await refreshAskDeliveries(this.container, updated, null)
    return updated
  }

  /** Commit to a pull request nobody raised an attention request for. */
  async commitToPullRequest(
    viewer: Reviewer,
    input: CreateReviewCommitment,
  ): Promise<ReviewCommitment> {
    return this.recordCommitment(viewer, input.pullRequest, input.title, null)
  }

  /**
   * Hand it back. Returns what is left rather than an acknowledgement, because
   * the third workspace column is what the caller is about to redraw. The host
   * request goes with it only when this commitment made it.
   */
  async release(viewer: Reviewer, commitmentId: string): Promise<ReviewCommitment[]> {
    const { repositories } = this.container
    const commitment = assertFound(
      await repositories.commitments.getById(commitmentId),
      `No commitment ${commitmentId}`,
    )
    if (commitment.reviewerId !== viewer.id) {
      throw new ForbiddenError('A commitment can only be released by the person who made it')
    }
    await repositories.commitments.delete(commitmentId)
    await withdrawCommittedReviewer(this.container, commitment)
    return repositories.commitments.listByReviewer(viewer.id)
  }

  /**
   * One commitment row, or the one already there. Idempotent on
   * `(reviewer, pull request)` so a second click, or committing to a pull
   * request twice through two different asks, does not double-count the
   * promise in the workspace.
   *
   * The row is written before the host is asked, so a second click finds it
   * while the host call is still in flight.
   */
  private async recordCommitment(
    viewer: Reviewer,
    pullRequest: PullRequestRef,
    title: string,
    attentionRequestId: string | null,
  ): Promise<ReviewCommitment> {
    const { repositories, clock, ids } = this.container
    const existing = await repositories.commitments.find(viewer.id, pullRequest)
    if (existing !== null) return existing
    const commitment = await repositories.commitments.create({
      id: ids.next(),
      reviewerId: viewer.id,
      pullRequest,
      title,
      attentionRequestId,
      requestedHandle: null,
      createdAt: clock.now(),
    })
    return requestCommittedReviewer(this.container, commitment, viewer)
  }

  private async requireOpen(attentionId: string): Promise<AttentionRequest> {
    const request = await this.require(attentionId)
    refuseClosed(request)
    return request
  }

  /**
   * A change that may ask more people, applied to the stored ask, and whoever
   * it asked as the change was last worked out.
   */
  private async applyChange(
    attentionId: string,
    decide: (stored: AttentionRequest) => AttentionChange,
  ): Promise<{ request: AttentionRequest; asked: Reviewer[] }> {
    let asked: Reviewer[] = []
    const { request } = await changeAsk(this.container, attentionId, (stored) => {
      const change = decide(stored)
      asked = change.asked
      return change.patch
    })
    return { request, asked }
  }

  private async require(attentionId: string): Promise<AttentionRequest> {
    return assertFound(
      await this.container.repositories.attention.getById(attentionId),
      `No attention request ${attentionId}`,
    )
  }

  private publish(kind: AttentionEventKind, request: AttentionRequest): void {
    this.container.bus.publish({ kind, request })
  }
}

function refuseClosed(request: AttentionRequest): void {
  if (request.status !== 'open') {
    throw new ConflictError(`This request is already ${request.status}`, {
      attentionId: request.id,
    })
  }
}

/** Throws for a decline this person cannot make on the ask as it stands. */
function refuseDecline(request: AttentionRequest, viewer: Reviewer): void {
  refuseClosed(request)
  const refusal = declineRefusal(request, viewer)
  if (refusal !== null) throw declineError(refusal, request.id)
}

function declineError(
  refusal: 'requester' | 'committed' | 'not_addressed',
  attentionId: string,
): Error {
  switch (refusal) {
    case 'requester':
      return new ForbiddenError('You asked for this review, so there is nothing to decline')
    case 'committed':
      return new ConflictError('You already said you will review this', { attentionId })
    case 'not_addressed':
      return new ForbiddenError('This request was not addressed to you')
  }
}

/**
 * Whether one person should see this request at all: the shared predicate
 * behind the REST inbox and the stream filter.
 *
 * A RESOLVED or cancelled request still concerns whoever it reached, which is
 * why this asks about the audience and not about the status: the whole point of
 * pushing the resolution is that the ask disappears from the inbox of people
 * who never answered it.
 */
export function concerns(request: AttentionRequest, viewer: Reviewer): boolean {
  if (request.requestedById === viewer.id) return true
  if (request.commitments.some((entry) => entry.reviewerId === viewer.id)) return true
  return isInAttentionAudience(viewer, audienceRuleOf(request))
}

/** Whether a live event should reach this person's stream. */
export function reaches(event: AttentionEvent, viewer: Reviewer): boolean {
  // A decline takes the ask out of the decliner's audience, and the event that
  // says so still has to reach their other open pages to take it off them.
  if (event.kind === 'declined' && hasDeclined(event.request, viewer.id)) return true
  return concerns(event.request, viewer)
}
