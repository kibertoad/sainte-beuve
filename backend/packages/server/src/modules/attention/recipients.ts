import type {
  AttentionRequest,
  CreateAttentionRequest,
  PullRequestPeople,
  PullRequestRef,
  Reviewer,
} from '@sainte-beuve/contracts'
import { MAX_ATTENTION_RECIPIENTS, MAX_RECOMMENDATIONS } from '@sainte-beuve/contracts'
import { ValidationError } from '@sainte-beuve/kernel'
import {
  type MatchTarget,
  type RecipientRefusal,
  type RecipientsResolution,
  askableRecipients,
  askedOrAnsweredIds,
  resolveAttentionRecipients,
  reviewersWithHandles,
  selectAttentionAudience,
  wantedOf,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { RecommendationService } from '../reviewers/RecommendationService.js'
import { loadPullRequestContext, wantedFor } from '../reviewers/wanted.js'

/**
 * Who an ask is addressed to: the people a requester picks, checked against
 * the directory as it stands now, the mix an ask nobody was named on is matched
 * on, and the ranked matches an ask moves on to when it has to.
 */

interface NamedAsk {
  pullRequest: PullRequestRef
  people: PullRequestPeople | null
}

const NOTHING_WANTED: MatchTarget = { skills: [], domains: [] }

/**
 * Who a new ask is addressed to and what it wants: the people it names, and
 * the skills and domains captured with it. Captured like the team, so editing
 * the repository's vocabulary later does not re-address an ask already out.
 */
export async function addressAsk(
  container: AppContainer,
  requester: Reviewer,
  input: CreateAttentionRequest,
): Promise<{ named: Reviewer[]; wanted: MatchTarget }> {
  const [named, context] = await Promise.all([
    namedRecipients(container, requester, input),
    loadPullRequestContext(container, input.pullRequest),
  ])
  const wanted = wantedFor(input.requiredSkills, context)
  if (named.length === 0) await refuseUnreachable(container, requester, { ...input, wanted })
  return { named, wanted }
}

/**
 * Refuse an ask nobody was named on when what it wants is what leaves its
 * audience empty: stored, it would sit in no inbox while somebody who could
 * have been asked never hears of it.
 */
async function refuseUnreachable(
  container: AppContainer,
  requester: Reviewer,
  ask: { sameTeamOnly: boolean; wanted: MatchTarget },
): Promise<void> {
  const directory = await container.repositories.reviewers.list()
  const rule = {
    recipientIds: [],
    sameTeamOnly: ask.sameTeamOnly,
    team: requester.team,
    requestedById: requester.id,
    declinedIds: [],
  }
  const askable = selectAttentionAudience(directory, { ...rule, wanted: NOTHING_WANTED })
  if (askable.length === 0) return
  if (selectAttentionAudience(askable, { ...rule, wanted: ask.wanted }).length > 0) return
  throw new ValidationError(
    'Nobody available holds at least half of what this ask wants. Pick fewer skills, or name people to ask.',
    { skills: ask.wanted.skills, domains: ask.wanted.domains },
  )
}

/** The people a requester names when raising an ask. */
async function namedRecipients(
  container: AppContainer,
  requester: Reviewer,
  input: NamedAsk & { recipientIds: readonly string[]; neededCommitments: number },
): Promise<Reviewer[]> {
  if (input.recipientIds.length === 0) return []
  const { directory, authorIds } = await directoryFor(container, input)
  const resolution = resolveAttentionRecipients({
    directory,
    requestedById: requester.id,
    recipientIds: input.recipientIds,
    neededCommitments: input.neededCommitments,
    authorIds,
  })
  return accepted(resolution, input.neededCommitments)
}

/**
 * People a requester names to add to an open ask. Anybody it has already been
 * to is passed over rather than refused, so a repeated click adds nobody twice.
 */
export async function namedAdditions(
  container: AppContainer,
  request: AttentionRequest,
  reviewerIds: readonly string[],
): Promise<Reviewer[]> {
  const taken = askedOrAnsweredIds(request)
  const fresh = [...new Set(reviewerIds)].filter((reviewerId) => !taken.has(reviewerId))
  if (request.recipients.length + fresh.length > MAX_ATTENTION_RECIPIENTS) {
    throw new ValidationError(`An ask can name at most ${MAX_ATTENTION_RECIPIENTS} people`, {
      recipients: request.recipients.length + fresh.length,
    })
  }
  if (fresh.length === 0) return []
  const { directory, authorIds } = await directoryFor(container, request)
  const resolution = askableRecipients({
    directory,
    requestedById: request.requestedById,
    recipientIds: fresh,
    authorIds,
  })
  return accepted(resolution, request.neededCommitments)
}

/**
 * The best matches for an ask, best first, ranked as the recommendations rank
 * them for the requester: against the skills and domains the ask stored, with
 * the same team filter and the same people left out. The people an ask moves
 * on to are then the ones the requester would have seen next on the list.
 * Whoever the ask has already been to is still in the list; `nextToAsk` passes
 * over them against the stored ask.
 */
export async function rankedCandidates(
  container: AppContainer,
  request: AttentionRequest,
): Promise<Reviewer[]> {
  const requester = await container.repositories.reviewers.getById(request.requestedById)
  if (requester === null) return []
  // The team captured when the ask was raised, as the gate uses, so a requester
  // who changed team since does not move the ask to another team's list.
  const asRaised = { ...requester, team: request.team }
  const { ranked } = await new RecommendationService(container).rank(
    asRaised,
    {
      pullRequest: request.pullRequest,
      requiredSkills: request.requiredSkills,
      sameTeamOnly: request.sameTeamOnly,
      people: request.people,
      limit: MAX_RECOMMENDATIONS,
    },
    wantedOf(request),
  )
  return ranked.map((candidate) => candidate.reviewer)
}

/**
 * The directory, and who in it wrote the pull request: its board row's author
 * when the board has it, and the author the host listed when the ask has that.
 */
async function directoryFor(
  container: AppContainer,
  ask: NamedAsk,
): Promise<{ directory: Reviewer[]; authorIds: string[] }> {
  const { repositories } = container
  const { pullRequest } = ask
  const [directory, boardRow] = await Promise.all([
    repositories.reviewers.list(),
    repositories.reviews.getByPullRequest(pullRequest),
  ])
  const logins = [
    ...(boardRow === null ? [] : [boardRow.authorLogin]),
    ...(ask.people === null ? [] : [ask.people.authorLogin]),
  ]
  return { directory, authorIds: reviewersWithHandles(directory, pullRequest.provider, logins) }
}

function accepted(resolution: RecipientsResolution, neededCommitments: number): Reviewer[] {
  if (resolution.ok) return resolution.reviewers
  throw refusalError(resolution.refusal, neededCommitments)
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
