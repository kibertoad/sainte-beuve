import * as v from 'valibot'

// ---------------------------------------------------------------------------
// AI-review wire contracts.
//
// sainte-beuve does not run the review itself: it hands the pull request to a
// cat-factory instance over the published `@cat-factory/sdk` and tracks the run.
// The instance is per deployment (a developer's own local cat-factory, or the
// org's centralized one), so nothing here assumes a URL.
// ---------------------------------------------------------------------------

/**
 * Lifecycle of one delegated review, mirroring what cat-factory reports back.
 * `requested` is the local-only state between our write and cat-factory
 * acknowledging the task, so a failure to reach it is distinguishable from a run
 * that started and then failed.
 */
export const aiReviewStatusSchema = v.picklist([
  'requested',
  'running',
  'completed',
  'failed',
  'cancelled',
])
export type AiReviewStatus = v.InferOutput<typeof aiReviewStatusSchema>

export const aiReviewRunSchema = v.object({
  id: v.string(),
  reviewId: v.string(),
  status: aiReviewStatusSchema,
  /** The cat-factory task this run delegated to. Null until the call is acknowledged. */
  catFactoryTaskId: v.nullable(v.string()),
  /** Deep link into the cat-factory instance that ran it. */
  catFactoryUrl: v.nullable(v.string()),
  /** Short verdict text once the run completes. The full output lives in cat-factory. */
  summary: v.nullable(v.string()),
  failureReason: v.nullable(v.string()),
  requestedAt: v.number(),
  completedAt: v.nullable(v.number()),
})
export type AiReviewRun = v.InferOutput<typeof aiReviewRunSchema>

export const requestAiReviewSchema = v.object({
  /**
   * Extra direction for the run, e.g. 'focus on the migration'. Optional: the
   * pull request and the review request's required skills are already the brief.
   */
  instructions: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000))), null),
})
export type RequestAiReview = v.InferOutput<typeof requestAiReviewSchema>
