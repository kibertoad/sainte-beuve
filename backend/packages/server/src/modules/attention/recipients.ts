import type { AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { MAX_ATTENTION_RECIPIENTS, MAX_RECOMMENDATIONS } from '@sainte-beuve/contracts'
import { ValidationError, assertFound } from '@sainte-beuve/kernel'
import { askedOrAnsweredIds } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { RecommendationService } from '../reviewers/RecommendationService.js'
import { deliverAsk } from './askDeliveries.js'

/**
 * Who an ask is addressed to by name: the people a requester picks, checked
 * against the directory, and the next best matches when an ask has to go on.
 */

/**
 * The people a requester named, checked against the directory as it stands
 * now. Each has to be somebody who could answer: in the directory, not paused,
 * and not the requester. Duplicates count once.
 */
export async function checkRecipients(
  container: AppContainer,
  requester: Reviewer,
  reviewerIds: readonly string[],
): Promise<Reviewer[]> {
  const wanted = [...new Set(reviewerIds)]
  if (wanted.length === 0) return []
  const directory = new Map(
    (await container.repositories.reviewers.list()).map((entry) => [entry.id, entry]),
  )
  return wanted.map((reviewerId) => {
    const reviewer = directory.get(reviewerId)
    if (reviewer === undefined) {
      throw new ValidationError(`No reviewer ${reviewerId} to ask`, { reviewerId })
    }
    if (reviewer.id === requester.id) {
      throw new ValidationError('You cannot ask yourself to review your own request', {
        reviewerId,
      })
    }
    if (reviewer.availability !== 'available') {
      throw new ValidationError(`${reviewer.displayName} is paused and cannot be asked`, {
        reviewerId,
      })
    }
    return reviewer
  })
}

/**
 * The next `count` best matches for an ask, best first, leaving out everybody
 * it has already been to. The ranking is the recommendations' own, read as the
 * requester would have read it, so the people an ask moves on to are the ones
 * the requester would have seen next on the list. Never more than the ask has
 * room to name.
 */
export async function nextRecipients(
  container: AppContainer,
  request: AttentionRequest,
  count: number,
): Promise<Reviewer[]> {
  const room = Math.min(count, MAX_ATTENTION_RECIPIENTS - request.recipients.length)
  if (room <= 0) return []
  const directory = await container.repositories.reviewers.list()
  const requester = directory.find((entry) => entry.id === request.requestedById)
  if (requester === undefined) return []
  const { recommendations } = await new RecommendationService(container).recommend(requester, {
    pullRequest: request.pullRequest,
    requiredSkills: request.requiredSkills,
    limit: MAX_RECOMMENDATIONS,
  })
  const taken = askedOrAnsweredIds(request)
  const byId = new Map(directory.map((entry) => [entry.id, entry]))
  return recommendations
    .filter((entry) => !taken.has(entry.reviewerId))
    .flatMap((entry) => byId.get(entry.reviewerId) ?? [])
    .slice(0, room)
}

/**
 * People a requester names to add to an ask. Anybody it has already been to
 * is passed over rather than refused, so a repeated click adds nobody twice.
 */
export async function namedAdditions(
  container: AppContainer,
  requester: Reviewer,
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
  return checkRecipients(container, requester, fresh)
}

/**
 * One write for a change to an ask that may add recipients. Their DMs go out
 * first, so the write carries where they landed: stored first and patched
 * after, a commit landing between the two writes would be overwritten.
 */
export async function saveWithRecipients(
  container: AppContainer,
  request: AttentionRequest,
  added: readonly Reviewer[],
  patch: Partial<AttentionRequest>,
): Promise<AttentionRequest> {
  const recipients = [
    ...request.recipients,
    ...added.map((reviewer) => ({ reviewerId: reviewer.id, displayName: reviewer.displayName })),
  ]
  const delivered =
    added.length === 0
      ? []
      : await deliverAsk(container, { ...request, ...patch, recipients }, added)
  return assertFound(
    await container.repositories.attention.update(request.id, {
      ...patch,
      recipients,
      chatDeliveries: [...request.chatDeliveries, ...delivered],
    }),
    `No attention request ${request.id}`,
  )
}
