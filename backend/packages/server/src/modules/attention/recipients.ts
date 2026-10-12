import type {
  AttentionRequest,
  PullRequestPeople,
  PullRequestRef,
  Reviewer,
} from '@sainte-beuve/contracts'
import { MAX_ATTENTION_RECIPIENTS, MAX_RECOMMENDATIONS } from '@sainte-beuve/contracts'
import { ValidationError } from '@sainte-beuve/kernel'
import {
  type RecipientRefusal,
  type RecipientsResolution,
  askableRecipients,
  askedOrAnsweredIds,
  resolveAttentionRecipients,
  reviewersWithHandles,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { RecommendationService } from '../reviewers/RecommendationService.js'

/**
 * Who an ask is addressed to by name: the people a requester picks, checked
 * against the directory as it stands now, and the ranked matches an ask moves
 * on to when it has to.
 */

interface NamedAsk {
  pullRequest: PullRequestRef
  people: PullRequestPeople | null
}

/** The people a requester names when raising an ask. */
export async function namedRecipients(
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
 * them for the requester: the same skills, the same team filter and the same
 * people left out. The people an ask moves on to are then the ones the
 * requester would have seen next on the list. Whoever the ask has already been
 * to is still in the list; `nextToAsk` passes over them against the stored ask.
 */
export async function rankedCandidates(
  container: AppContainer,
  request: AttentionRequest,
): Promise<Reviewer[]> {
  const directory = await container.repositories.reviewers.list()
  const requester = directory.find((entry) => entry.id === request.requestedById)
  if (requester === undefined) return []
  const { recommendations } = await new RecommendationService(container).recommend(requester, {
    pullRequest: request.pullRequest,
    requiredSkills: request.requiredSkills,
    sameTeamOnly: request.sameTeamOnly,
    people: request.people,
    limit: MAX_RECOMMENDATIONS,
  })
  const byId = new Map(directory.map((entry) => [entry.id, entry]))
  return recommendations.flatMap((entry) => byId.get(entry.reviewerId) ?? [])
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
  // The board looks a row up by owner, repo and number alone, so a row from
  // the other host under the same names is not this pull request.
  const logins = [
    ...(boardRow?.pullRequest.provider === pullRequest.provider ? [boardRow.authorLogin] : []),
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
