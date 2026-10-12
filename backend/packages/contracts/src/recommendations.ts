import * as v from 'valibot'
import { domainSchema } from './orgs.js'
import { skillSchema } from './reviewers.js'
import { shortfallReasonSchema } from './reviews.js'
import { pullRequestRefSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Reviewer recommendations: who fits a pull request best, and why.
//
// The ranking is the router's own score laid out best first, so the list an
// author reads and the odds an automatic assignment draws with agree. Each entry
// carries its reasons as named fields, which is where a new reason is added
// without breaking a client that reads the ones it knows.
// ---------------------------------------------------------------------------

/** The most recommendations one read returns. */
export const MAX_RECOMMENDATIONS = 25

export const recommendReviewersSchema = v.object({
  pullRequest: pullRequestRefSchema,
  /**
   * The skills to match on. Empty means "what the pull request already wants":
   * the skills on its board row, or else its repository's.
   */
  requiredSkills: v.optional(v.array(skillSchema), () => []),
  limit: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_RECOMMENDATIONS)),
    10,
  ),
})
export type RecommendReviewers = v.InferOutput<typeof recommendReviewersSchema>

/** Why a candidate ranks where it does. */
export const recommendationReasonsSchema = v.object({
  /** The wanted skills this reviewer holds. */
  matchedSkills: v.array(skillSchema),
  /** The repository's domains this reviewer knows. */
  matchedDomains: v.array(domainSchema),
  /** Reviews this person is already on, which lowers their score. */
  outstandingReviews: v.number(),
})
export type RecommendationReasons = v.InferOutput<typeof recommendationReasonsSchema>

export const reviewerRecommendationSchema = v.object({
  reviewerId: v.string(),
  displayName: v.string(),
  team: v.nullable(v.string()),
  /** The reviewer's share of an automatic draw. Comparable only within one response. */
  score: v.number(),
  reasons: recommendationReasonsSchema,
})
export type ReviewerRecommendation = v.InferOutput<typeof reviewerRecommendationSchema>

export const reviewerRecommendationsSchema = v.object({
  /** What the candidates were matched against, so a screen can say "2 of 3". */
  wanted: v.object({ skills: v.array(skillSchema), domains: v.array(domainSchema) }),
  /** Best first. */
  recommendations: v.array(reviewerRecommendationSchema),
  /** Set only when the list is empty, saying why. */
  shortfallReason: v.nullable(shortfallReasonSchema),
})
export type ReviewerRecommendations = v.InferOutput<typeof reviewerRecommendationsSchema>
