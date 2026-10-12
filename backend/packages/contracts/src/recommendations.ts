import * as v from 'valibot'
import { domainSchema } from './orgs.js'
import { skillSchema } from './reviewers.js'
import { shortfallReasonSchema } from './reviews.js'
import { pullRequestRefSchema } from './vcs.js'

// Reviewer recommendations: who an author asking for attention should pick for
// a pull request, best first, and why. The pool is the people an ask could
// reach; the order is fit, raised for past reviews in the repository, first and
// open reviews second. Each entry carries its
// reasons as named fields, which is where a new reason is added without
// breaking a client that reads the ones it knows.

/** The most recommendations one read returns. */
export const MAX_RECOMMENDATIONS = 25

/** What the host lists for the pull request, which the board may not have recorded. */
export const pullRequestPeopleSchema = v.object({
  /** The author's handle on the pull request's host. */
  authorLogin: v.string(),
  /** Handles the host has already been asked to get a review from. */
  requestedReviewerLogins: v.array(v.string()),
})
export type PullRequestPeople = v.InferOutput<typeof pullRequestPeopleSchema>

export const recommendReviewersSchema = v.object({
  pullRequest: pullRequestRefSchema,
  /**
   * The skills to match on. Empty means "what the pull request already wants":
   * the skills on its board row, or else its repository's.
   */
  requiredSkills: v.optional(v.array(skillSchema), () => []),
  /** Whether the ask stays inside the caller's team, as the attention request's flag. */
  sameTeamOnly: v.optional(v.boolean(), false),
  /**
   * The pull request's author and requested reviewers as the host lists them.
   * Everybody named is left out, which matters most for a pull request with no
   * board row, where the server knows neither.
   */
  people: v.optional(v.nullable(pullRequestPeopleSchema), null),
  limit: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_RECOMMENDATIONS)),
    10,
  ),
})
export type RecommendReviewers = v.InferOutput<typeof recommendReviewersSchema>
export type RecommendReviewersInput = v.InferInput<typeof recommendReviewersSchema>

/** Why a candidate ranks where it does. */
export const recommendationReasonsSchema = v.object({
  /** The wanted skills this reviewer holds. */
  matchedSkills: v.array(skillSchema),
  /** The repository's domains this reviewer knows. */
  matchedDomains: v.array(domainSchema),
  /** Reviews this person is already on. Among otherwise equal candidates, fewer ranks higher. */
  outstandingReviews: v.number(),
  /**
   * Reviews this person finished on the pull request's repository recently,
   * which raise their rank with diminishing returns. Counted from the board,
   * so a review the deployment never tracked is not in it.
   */
  pastReviews: v.number(),
})
export type RecommendationReasons = v.InferOutput<typeof recommendationReasonsSchema>

export const reviewerRecommendationSchema = v.object({
  reviewerId: v.string(),
  displayName: v.string(),
  team: v.nullable(v.string()),
  /** The share of the wanted skills and domains this reviewer holds, from 0 to 1. */
  fit: v.number(),
  reasons: recommendationReasonsSchema,
})
export type ReviewerRecommendation = v.InferOutput<typeof reviewerRecommendationSchema>

export const reviewerRecommendationsSchema = v.object({
  /** What the candidates were matched against, each once, so a screen can say "2 of 3". */
  wanted: v.object({ skills: v.array(skillSchema), domains: v.array(domainSchema) }),
  /** Best first. */
  recommendations: v.array(reviewerRecommendationSchema),
  /** Set only when the list is empty, saying why. */
  shortfallReason: v.nullable(shortfallReasonSchema),
})
export type ReviewerRecommendations = v.InferOutput<typeof reviewerRecommendationsSchema>
