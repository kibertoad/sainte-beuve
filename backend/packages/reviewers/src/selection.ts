import type { Reviewer, Skill } from '@sainte-beuve/contracts'

/**
 * Reviewer selection: skill matching, then a load-aware weighted random pick.
 *
 * "Random" rather than round-robin on purpose. A deterministic rotation is
 * predictable in the bad sense: people learn their slot, pre-empt it, and trade it
 * away, and the rotation stops reflecting who is actually free. Weighted random
 * keeps the long-run share honest (a 0.5 reviewer really does get half the load)
 * while no single assignment is anybody's turn to resent.
 *
 * Every function here is pure. The randomness is an injected `random()` so a test
 * pins the outcome instead of asserting on a distribution.
 */

/** A candidate scored for one review, kept beside the reviewer so a caller can explain a pick. */
export interface ScoredCandidate {
  reviewer: Reviewer
  /** How many of the required skills this reviewer has. Equal to `requiredSkills.length` on a full match. */
  matchedSkills: number
  /** The reviewer's share of the draw. Higher is likelier; never zero for a candidate. */
  weight: number
}

export interface SelectionInput {
  candidates: Reviewer[]
  requiredSkills: Skill[]
  /** Reviewer ids that must not be picked: the author, anyone already on, the caller's vetoes. */
  excludeReviewerIds: readonly string[]
  count: number
}

export interface SelectionResult {
  selected: Reviewer[]
  /** Set when fewer than `count` came back, so the caller can say why rather than shrug. */
  shortfallReason: 'no_candidates' | 'pool_exhausted' | null
}

/** Case-insensitive skill comparison: 'TypeScript' and 'typescript' are one skill. */
function normalizeSkill(skill: string): string {
  return skill.trim().toLowerCase()
}

/**
 * Whether two GitHub logins name the same account. GitHub logins are
 * case-insensitive, and the same person arrives spelled two ways: a webhook
 * carries the casing GitHub stores, a reviewer registered by hand carries whatever
 * was typed. Compared exactly, `Kibertoad` and `kibertoad` are two people, and the
 * author lands in their own review's candidate pool.
 */
export function isSameGithubLogin(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/**
 * Whether a reviewer can take this review at all. Skills are an ALL-of gate, not a
 * ranking: a review that needs `payments` should not fall to somebody who merely
 * knows `typescript`, because a partial match here reads to the author as a real
 * review and is not one.
 */
export function isEligible(
  reviewer: Reviewer,
  requiredSkills: readonly string[],
  excluded: ReadonlySet<string>,
): boolean {
  if (excluded.has(reviewer.id)) return false
  if (reviewer.availability !== 'available') return false
  if (reviewer.weight <= 0) return false
  if (requiredSkills.length === 0) return true
  const owned = new Set(reviewer.skills.map(normalizeSkill))
  return requiredSkills.every((skill) => owned.has(normalizeSkill(skill)))
}

/**
 * Draw weight for one eligible reviewer: their configured share, damped by what
 * they already owe. The `1 / (1 + outstanding)` term is what stops the pool
 * converging on whoever answers fastest: a reviewer with three open reviews is
 * drawn a quarter as often as an idle peer of the same weight, without ever being
 * excluded outright (which would starve a small team).
 */
export function drawWeight(reviewer: Reviewer): number {
  return reviewer.weight / (1 + reviewer.outstandingReviews)
}

export function scoreCandidates(
  candidates: readonly Reviewer[],
  requiredSkills: readonly string[],
  excludeReviewerIds: readonly string[],
): ScoredCandidate[] {
  const excluded = new Set(excludeReviewerIds)
  const required = requiredSkills.map(normalizeSkill)
  return candidates
    .filter((reviewer) => isEligible(reviewer, required, excluded))
    .map((reviewer) => ({
      reviewer,
      matchedSkills: required.length,
      weight: drawWeight(reviewer),
    }))
}

/** One weighted draw. Returns the index, or -1 for an empty pool. */
function drawIndex(weights: readonly number[], random: () => number): number {
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return -1
  let threshold = random() * total
  for (let i = 0; i < weights.length; i++) {
    threshold -= weights[i] ?? 0
    if (threshold < 0) return i
  }
  // Only reachable through float drift when `random()` lands on ~1; the last
  // candidate is the correct answer there, not a failure.
  return weights.length - 1
}

/**
 * Pick up to `count` reviewers, without replacement.
 *
 * `random` defaults to `Math.random` and is injected everywhere else: the caller in
 * @sainte-beuve/server passes the platform one, and the suites pass a scripted
 * sequence, so the same code path is exercised in both.
 */
export function selectReviewers(
  input: SelectionInput,
  random: () => number = Math.random,
): SelectionResult {
  const pool = scoreCandidates(input.candidates, input.requiredSkills, input.excludeReviewerIds)
  if (pool.length === 0) return { selected: [], shortfallReason: 'no_candidates' }

  const remaining = [...pool]
  const selected: Reviewer[] = []
  while (selected.length < input.count && remaining.length > 0) {
    const index = drawIndex(
      remaining.map((candidate) => candidate.weight),
      random,
    )
    if (index < 0) break
    const [picked] = remaining.splice(index, 1)
    if (picked) selected.push(picked.reviewer)
  }

  if (selected.length === input.count) return { selected, shortfallReason: null }
  return { selected, shortfallReason: 'pool_exhausted' }
}
