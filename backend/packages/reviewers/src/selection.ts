import type { Reviewer, ShortfallReason } from '@sainte-beuve/contracts'

/**
 * Reviewer selection: a load-aware weighted random pick that favours the
 * reviewers whose skills and domains come closest to what the review wants.
 *
 * Nobody available is excluded for lacking a skill. A backend engineer can still
 * review a frontend change, less effectively, and a gate would leave a review
 * unassigned whenever the one person holding a skill is busy. The mix is a
 * preference: each wanted skill or domain a reviewer holds raises their share.
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

/** What a review wants from its reviewer. */
export interface MatchTarget {
  skills: readonly string[]
  domains: readonly string[]
}

/**
 * What a review wants: the skills it asked for, or else the ones its repository
 * names, and the repository's domains. A review on a repository nobody
 * registered wants only what it asked for.
 */
export function matchTargetFor(
  review: { requiredSkills: readonly string[] },
  project: MatchTarget | null,
): MatchTarget {
  return {
    skills: review.requiredSkills.length > 0 ? review.requiredSkills : (project?.skills ?? []),
    domains: project?.domains ?? [],
  }
}

/** A candidate scored for one review, kept beside the reviewer so a caller can explain a pick. */
export interface ScoredCandidate {
  reviewer: Reviewer
  /** How many of the wanted skills this reviewer holds. */
  matchedSkills: number
  /** How many of the wanted domains this reviewer knows. */
  matchedDomains: number
  /** The reviewer's share of the draw. Higher is likelier; never zero for a candidate. */
  weight: number
}

export interface SelectionInput extends MatchTarget {
  candidates: Reviewer[]
  /** Reviewer ids that must not be picked: the author, anyone already on, the caller's vetoes. */
  excludeReviewerIds: readonly string[]
  count: number
}

export interface SelectionResult {
  selected: Reviewer[]
  /** Set when fewer than `count` came back, so the caller can say why rather than shrug. */
  shortfallReason: ShortfallReason | null
}

/**
 * How many times more often a reviewer holding the WHOLE wanted mix is drawn
 * than one holding none of it, minus one. Holding half the mix earns half the
 * boost, so a full match is drawn five times as often as a stranger to it.
 */
export const MATCH_PREFERENCE = 4

/** Case-insensitive comparison: 'TypeScript' and 'typescript' are one skill, and one domain. */
export function normalizeSkill(skill: string): string {
  return skill.trim().toLowerCase()
}

/**
 * Whether two handles name the same account. GitHub and GitLab handles are both
 * case-insensitive, and the same person arrives spelled two ways: a webhook or a
 * listing carries the casing the host stores, a reviewer registered by hand
 * carries whatever was typed. Compared exactly, `Kibertoad` and `kibertoad` are
 * two people, and the author lands in their own review's candidate pool.
 */
export function isSameHandle(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/**
 * Whether a reviewer holds every named skill. The gate an attention request
 * addresses its audience by; review selection scores skills instead. An empty
 * requirement matches everybody.
 */
export function hasAllSkills(reviewer: Reviewer, requiredSkills: readonly string[]): boolean {
  if (requiredSkills.length === 0) return true
  const owned = new Set(reviewer.skills.map(normalizeSkill))
  return requiredSkills.every((skill) => owned.has(normalizeSkill(skill)))
}

/** Whether the router may hand a review to this reviewer at all. */
export function isEligible(reviewer: Reviewer, excluded: ReadonlySet<string>): boolean {
  if (excluded.has(reviewer.id)) return false
  if (reviewer.availability !== 'available') return false
  return reviewer.weight > 0
}

/**
 * Draw weight for one eligible reviewer before the match: their configured share,
 * damped by what they already owe. The `1 / (1 + outstanding)` term is what stops
 * the pool converging on whoever answers fastest: a reviewer with three open
 * reviews is drawn a quarter as often as an idle peer of the same weight, without
 * ever being excluded outright (which would starve a small team).
 */
export function drawWeight(reviewer: Reviewer): number {
  return reviewer.weight / (1 + reviewer.outstandingReviews)
}

/** The entries of a list, normalised, each once. */
function distinct(list: readonly string[]): string[] {
  return [...new Set(list.map(normalizeSkill))]
}

/** How many of `wanted` appear in `held`, compared case-insensitively. */
function countHeld(held: readonly string[], wanted: readonly string[]): number {
  const owned = new Set(held.map(normalizeSkill))
  return distinct(wanted).filter((entry) => owned.has(entry)).length
}

/**
 * Skills and domains count alike: the mix is one list of what the review
 * wants, and the affinity is the share of it the reviewer holds.
 */
export function scoreCandidate(reviewer: Reviewer, target: MatchTarget): ScoredCandidate {
  const matchedSkills = countHeld(reviewer.skills, target.skills)
  const matchedDomains = countHeld(reviewer.domains, target.domains)
  const wanted = distinct(target.skills).length + distinct(target.domains).length
  const affinity = wanted === 0 ? 0 : (matchedSkills + matchedDomains) / wanted
  return {
    reviewer,
    matchedSkills,
    matchedDomains,
    weight: drawWeight(reviewer) * (1 + MATCH_PREFERENCE * affinity),
  }
}

export function scoreCandidates(
  candidates: readonly Reviewer[],
  target: MatchTarget,
  excludeReviewerIds: readonly string[],
): ScoredCandidate[] {
  const excluded = new Set(excludeReviewerIds)
  return candidates
    .filter((reviewer) => isEligible(reviewer, excluded))
    .map((reviewer) => scoreCandidate(reviewer, target))
}

/**
 * Why the candidate pool came back empty.
 *
 * Checked from the coarsest cause to the finest, because the first one that holds is
 * the one worth telling somebody about: an all-paused pool is not an exclusion
 * problem. `all_excluded` is the fallback: somebody is available, and the only
 * gate left in `isEligible` is the exclusion list, so the exclusion emptied it.
 */
export function diagnoseShortfall(candidates: readonly Reviewer[]): ShortfallReason {
  if (candidates.length === 0) return 'no_reviewers'
  const selectable = candidates.some(
    (reviewer) => reviewer.availability === 'available' && reviewer.weight > 0,
  )
  return selectable ? 'all_excluded' : 'none_available'
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
  const pool = scoreCandidates(input.candidates, input, input.excludeReviewerIds)
  if (pool.length === 0) {
    return { selected: [], shortfallReason: diagnoseShortfall(input.candidates) }
  }

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
