import type {
  AttentionRequest,
  Reviewer,
  SuggestedReviewerState,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { handleOf } from '@sainte-beuve/contracts'
import { unaskableReason } from './attention.js'
import { isBotLogin } from './dependencyBots.js'

/**
 * Who an author picks reviewers for their own pull request from: the ranked
 * matches, the top few ticked for them, everybody else they could still ask,
 * and the people already on it, each saying how.
 */

export interface ReviewerSuggestionsInput<T extends { reviewer: Reviewer }> {
  /** Best first, as `rankCandidates` answers. */
  ranked: readonly T[]
  directory: readonly Reviewer[]
  provider: VcsProvider
  requestedById: string
  /** Reviewer ids of the pull request's author. */
  authorIds: readonly string[]
  /** Who committed to reviewing it, through an ask or not. */
  committedIds: readonly string[]
  /** Who the host already lists as a requested reviewer. */
  requestedIds: readonly string[]
  /** The open asks on the pull request, whoever raised them. */
  asks: readonly AttentionRequest[]
  /** How many ranked people to offer. */
  limit: number
  /** How many people the author should end up with, counting those already on it. */
  wanted: number
}

export interface ReviewerSuggestionPlan<T> {
  candidates: T[]
  preselectedIds: string[]
  /** Everybody else who could be asked, by name. */
  others: Reviewer[]
  involved: { reviewer: Reviewer; state: SuggestedReviewerState }[]
}

export function planReviewerSuggestions<T extends { reviewer: Reviewer }>(
  input: ReviewerSuggestionsInput<T>,
): ReviewerSuggestionPlan<T> {
  const states = involvementOf(input)
  const authors = new Set(input.authorIds)
  const askable = (reviewer: Reviewer) =>
    !states.has(reviewer.id) &&
    !authors.has(reviewer.id) &&
    unaskableReason(reviewer, input.requestedById) === null &&
    !isBotReviewer(reviewer, input.provider)
  const candidates = input.ranked.filter((entry) => askable(entry.reviewer)).slice(0, input.limit)
  const offered = new Set(candidates.map((entry) => entry.reviewer.id))
  const covered = [...states.values()].filter((state) => state !== 'declined').length
  return {
    candidates,
    preselectedIds: candidates
      .slice(0, Math.max(0, input.wanted - covered))
      .map((entry) => entry.reviewer.id),
    others: input.directory
      .filter((reviewer) => askable(reviewer) && !offered.has(reviewer.id))
      .toSorted((left, right) => left.displayName.localeCompare(right.displayName, 'en')),
    involved: input.directory.flatMap((reviewer) => {
      const state = states.get(reviewer.id)
      return state === undefined ? [] : [{ reviewer, state }]
    }),
  }
}

/** A directory entry whose handle on the host is a bot account. */
export function isBotReviewer(reviewer: Reviewer, provider: VcsProvider): boolean {
  const handle = handleOf(reviewer.handles, provider)
  return handle !== null && isBotLogin(handle)
}

/** The strongest thing each person has already done about the pull request. */
function involvementOf(
  input: Pick<
    ReviewerSuggestionsInput<never>,
    'asks' | 'committedIds' | 'requestedIds' | 'requestedById'
  >,
): Map<string, SuggestedReviewerState> {
  const states = new Map<string, SuggestedReviewerState>()
  const mark = (ids: Iterable<string>, state: SuggestedReviewerState) => {
    for (const id of ids) {
      if (id !== input.requestedById && !states.has(id)) states.set(id, state)
    }
  }
  const asks = input.asks
  mark(input.committedIds, 'committed')
  mark(
    asks.flatMap((ask) => ask.commitments.map((entry) => entry.reviewerId)),
    'committed',
  )
  const declined = new Set(asks.flatMap((ask) => ask.declines.map((entry) => entry.reviewerId)))
  mark(
    asks
      .flatMap((ask) => ask.recipients.map((entry) => entry.reviewerId))
      .filter((id) => !declined.has(id)),
    'asked',
  )
  mark(input.requestedIds, 'requested')
  mark(declined, 'declined')
  return states
}
