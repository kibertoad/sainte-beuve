import type { Reviewer, ShortfallReason } from '@sainte-beuve/contracts'
import {
  type MatchTarget,
  type ScoredCandidate,
  diagnoseShortfall,
  scoreCandidates,
} from './selection.js'

/**
 * Reviewer recommendation: the same candidates and the same score the draw in
 * `selectReviewers` uses, laid out best first so a person can choose.
 *
 * It ranks on the draw weight itself, so the list an author reads and the odds
 * the router assigns with cannot disagree about who fits best.
 */

export interface RankingInput extends MatchTarget {
  candidates: readonly Reviewer[]
  /** Reviewer ids that must not be recommended: the author, anyone already on, the caller. */
  excludeReviewerIds: readonly string[]
  limit: number
}

export interface RankingResult {
  ranked: ScoredCandidate[]
  /** Set only when nobody could be recommended at all, saying why. */
  shortfallReason: ShortfallReason | null
}

/**
 * Best first: the higher draw weight, then the display name, then the id, so two
 * reviewers on the same score never swap places between two reads.
 */
export function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  if (left.weight !== right.weight) return right.weight - left.weight
  const byName = left.reviewer.displayName.localeCompare(right.reviewer.displayName)
  if (byName !== 0) return byName
  if (left.reviewer.id === right.reviewer.id) return 0
  return left.reviewer.id < right.reviewer.id ? -1 : 1
}

export function rankCandidates(input: RankingInput): RankingResult {
  const ranked = scoreCandidates(input.candidates, input, input.excludeReviewerIds)
    .toSorted(compareCandidates)
    .slice(0, input.limit)
  if (ranked.length > 0) return { ranked, shortfallReason: null }
  return { ranked, shortfallReason: diagnoseShortfall(input.candidates) }
}
