import type {
  AttentionEvent,
  AttentionEventKind,
  AttentionRecipient,
  AttentionRequest,
  CreateAttentionRequest,
  CreateReviewCommitment,
  PullRequestRef,
  Reviewer,
  ReviewCommitment,
} from '@sainte-beuve/contracts'
import { ConflictError, ForbiddenError, ValidationError, assertFound } from '@sainte-beuve/kernel'
import {
  type RecipientRefusal,
  audienceRuleOf,
  isAttentionSatisfied,
  isInAttentionAudience,
  resolveAttentionRecipients,
  reviewersWithHandles,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import {
  requestCommittedReviewer,
  withdrawCommittedReviewer,
} from '../../integrations/reviewRequests.js'

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
    const recipients = await this.resolveRecipients(viewer, input)
    const now = clock.now()
    const request = await repositories.attention.create({
      id: ids.next(),
      pullRequest: input.pullRequest,
      title: input.title,
      requestedById: viewer.id,
      requestedByName: viewer.displayName,
      recipients,
      requiredSkills: input.requiredSkills,
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
    })
    this.publish('opened', request)
    return request
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

    const now = this.container.clock.now()
    const commitments = [
      ...request.commitments,
      { reviewerId: viewer.id, displayName: viewer.displayName, committedAt: now },
    ]
    const satisfied = isAttentionSatisfied({ ...request, commitments })
    // The commitment row FIRST, then the ask, then the event. Both writes are
    // needed and there is no transaction across them, so the order decides what
    // a failure between them leaves behind: this way a refused second write
    // leaves the ask open with a commitment nobody lost, and the retry finds
    // that row and is a no-op. The other way round resolves the ask, drops the
    // promise, and tells nobody.
    await this.recordCommitment(viewer, request.pullRequest, request.title, attentionId)
    const updated = assertFound(
      await this.container.repositories.attention.update(attentionId, {
        commitments,
        status: satisfied ? 'resolved' : 'open',
        updatedAt: now,
        resolvedAt: satisfied ? now : null,
      }),
      `No attention request ${attentionId}`,
    )
    this.publish(satisfied ? 'resolved' : 'committed', updated)
    return updated
  }

  /** The requester withdrawing. Nobody else can: it is their ask to end. */
  async cancel(viewer: Reviewer, attentionId: string): Promise<AttentionRequest> {
    const request = await this.require(attentionId)
    if (request.requestedById !== viewer.id) {
      throw new ForbiddenError('Only the person who asked for attention can withdraw the request')
    }
    if (request.status !== 'open') return request
    const updated = assertFound(
      await this.container.repositories.attention.update(attentionId, {
        status: 'cancelled',
        updatedAt: this.container.clock.now(),
      }),
      `No attention request ${attentionId}`,
    )
    this.publish('cancelled', updated)
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

  /**
   * The people an ask names, checked against the directory as it stands now.
   * The pull request's author is known from its board row, when it has one.
   */
  private async resolveRecipients(
    viewer: Reviewer,
    input: CreateAttentionRequest,
  ): Promise<AttentionRecipient[]> {
    if (input.recipientIds.length === 0) return []
    const { repositories } = this.container
    const [directory, boardRow] = await Promise.all([
      repositories.reviewers.list(),
      repositories.reviews.getByPullRequest(input.pullRequest),
    ])
    // The board looks a row up by owner, repo and number alone, so a row from
    // the other host under the same names is not this pull request.
    const authorIds =
      boardRow?.pullRequest.provider === input.pullRequest.provider
        ? reviewersWithHandles(directory, input.pullRequest.provider, [boardRow.authorLogin])
        : []
    const resolution = resolveAttentionRecipients({
      directory,
      requestedById: viewer.id,
      recipientIds: input.recipientIds,
      neededCommitments: input.neededCommitments,
      authorIds,
    })
    if (resolution.ok) return resolution.recipients
    throw refusalError(resolution.refusal, input.neededCommitments)
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

function refusalError(refusal: RecipientRefusal, neededCommitments: number): ValidationError {
  switch (refusal.reason) {
    case 'too_few':
      return new ValidationError(
        `This ask waits for ${neededCommitments} reviewers but names only ${refusal.named}`,
        { neededCommitments, recipients: refusal.named },
      )
    case 'unknown':
      return new ValidationError(`No reviewer ${refusal.reviewerId} to ask`, {
        reviewerId: refusal.reviewerId,
      })
    case 'requester':
      return new ValidationError('You cannot ask yourself to review your own request', {
        reviewerId: refusal.reviewer.id,
      })
    case 'paused':
      return new ValidationError(`${refusal.reviewer.displayName} is paused and cannot be asked`, {
        reviewerId: refusal.reviewer.id,
      })
    case 'author':
      return new ValidationError(
        `${refusal.reviewer.displayName} wrote this pull request and cannot be asked to review it`,
        { reviewerId: refusal.reviewer.id },
      )
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
  return concerns(event.request, viewer)
}
