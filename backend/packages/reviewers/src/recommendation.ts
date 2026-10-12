import type { Reviewer, ShortfallReason } from '@sainte-beuve/contracts'
import { type AttentionAudienceRule, isInAttentionAudience } from './attention.js'
import { type ScoredCandidate, type ScoringTarget, scoreCandidate } from './selection.js'

/**
 * Reviewer recommendation: who an author asking for attention should pick,
 * best first.
 *
 * The pool is the attention audience without its skill gate, because a pick
 * becomes an ask: the requester is never in it, a paused reviewer is not, a
 * weight of 0 does not keep anybody out, and "only my team" narrows it. The
 * candidates are scored as the router scores them, then ranked on the
 * preference the draw starts from (the wanted mix held, raised for past
 * reviews in the repository) and on load second. A person choosing reads the
 * load beside each name and weighs it themselves; ranking on the draw weight
 * would bury the one expert under idle strangers whenever the expert is busy.
 */

export interface RankingInput extends ScoringTarget {
  candidates: readonly Reviewer[]
  /** Who is asking, and whether the ask stays in their team. */
  audience: Omit<AttentionAudienceRule, 'requiredSkills' | 'recipientIds' | 'declinedIds'>
  /** Reviewer ids that must not be recommended: the author, and anyone already on or asked. */
  excludeReviewerIds: readonly string[]
  limit: number
}

export interface RankingResult {
  ranked: ScoredCandidate[]
  /** Set only when nobody could be recommended at all, saying why. */
  shortfallReason: ShortfallReason | null
}

/**
 * Best first: the larger preference, then fewer open reviews, then
 * the larger configured weight, then the display name and the id, so two equal
 * reviewers never swap places between two reads. The locale is pinned so the
 * order does not follow the default locale of the host runtime.
 */
export function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  if (left.preference !== right.preference) return right.preference - left.preference
  const byLoad = left.reviewer.outstandingReviews - right.reviewer.outstandingReviews
  if (byLoad !== 0) return byLoad
  if (left.reviewer.weight !== right.reviewer.weight) {
    return right.reviewer.weight - left.reviewer.weight
  }
  const byName = left.reviewer.displayName.localeCompare(right.reviewer.displayName, 'en')
  if (byName !== 0) return byName
  if (left.reviewer.id === right.reviewer.id) return 0
  return left.reviewer.id < right.reviewer.id ? -1 : 1
}

export function rankCandidates(input: RankingInput): RankingResult {
  const excluded = new Set(input.excludeReviewerIds)
  const rule: AttentionAudienceRule = {
    ...input.audience,
    recipientIds: [],
    requiredSkills: [],
    declinedIds: [],
  }
  const ranked = input.candidates
    .filter((reviewer) => !excluded.has(reviewer.id) && isInAttentionAudience(reviewer, rule))
    .map((reviewer) => scoreCandidate(reviewer, input))
    .toSorted(compareCandidates)
    .slice(0, input.limit)
  if (ranked.length > 0) return { ranked, shortfallReason: null }
  return { ranked, shortfallReason: diagnoseEmptyPool(input.candidates) }
}

/**
 * Why nobody could be recommended. The weight is no gate here, unlike the
 * router's `diagnoseShortfall`, so anybody available means the exclusions
 * emptied the pool.
 */
function diagnoseEmptyPool(candidates: readonly Reviewer[]): ShortfallReason {
  if (candidates.length === 0) return 'no_reviewers'
  const available = candidates.some((reviewer) => reviewer.availability === 'available')
  return available ? 'all_excluded' : 'none_available'
}
