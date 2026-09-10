import { defineApiContract } from '@toad-contracts/valibot'
import * as v from 'valibot'
import { aiReviewRunSchema, requestAiReviewSchema, resolveAiReviewSchema } from '../ai-review.js'
import { errorResponses, singleStringParam, stringParams } from './_shared.js'

// ---------------------------------------------------------------------------
// The AI-review loop: file a review, read what it found, say which findings are
// worth a comment, put them on the pull request. See AiReviewController in
// @sainte-beuve/server.
//
// Filing and listing are addressed by the REVIEW, because that is what somebody
// delegates. Everything after it is addressed by the RUN, mirroring cat-factory's
// own decision surface: a curation verb acts on one delegated run, and threading
// the review id back through the path would let a caller name a pair that does
// not go together.
// ---------------------------------------------------------------------------

const reviewIdParams = singleStringParam('reviewId')
const runIdParams = singleStringParam('runId')
const runListSchema = v.object({ runs: v.array(aiReviewRunSchema) })

export const requestAiReviewContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}/ai-review`,
  requestBodySchema: requestAiReviewSchema,
  responsesByStatusCode: { 202: aiReviewRunSchema, ...errorResponses },
})

/**
 * Every delegated run for one review, each POLLED before it is answered.
 *
 * The refresh is the point rather than an optimisation. cat-factory drives the
 * review asynchronously and calls nothing back (a local deployment has no
 * inbound URL for it to call), so a read that answered from the store would show
 * a review as `running` for as long as nobody happened to poll it, and the
 * findings it parked with would never arrive. Only runs still in flight cost a
 * call; a settled one is answered from the row.
 */
export const listAiReviewRunsContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}/ai-review`,
  responsesByStatusCode: { 200: runListSchema, ...errorResponses },
})

/** One run, polled. What a screen watching a single review re-reads. */
export const getAiReviewRunContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: runIdParams,
  pathResolver: ({ runId }) => `/ai-review/runs/${runId}`,
  responsesByStatusCode: { 200: aiReviewRunSchema, ...errorResponses },
})

/**
 * Drop one finding from the parked review.
 *
 * Curation, not a resolution: the review stays parked and the run stays in
 * flight. A dismissed finding disappears from the list, and so does its row on
 * the post report, so no id on this surface ever names a finding the caller can
 * no longer see.
 */
export const dismissAiReviewFindingContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: stringParams('runId', 'findingId'),
  pathResolver: ({ runId, findingId }) => `/ai-review/runs/${runId}/findings/${findingId}/dismiss`,
  requestBodySchema: v.object({}),
  responsesByStatusCode: { 200: aiReviewRunSchema, ...errorResponses },
})

/**
 * Record the curated selection and say what to do with it.
 *
 * 202 rather than 200: cat-factory resolves asynchronously, so what comes back
 * is the review having ACCEPTED the instruction, not the comments being up. The
 * receipt arrives on a later read, as `postReport` on the curation.
 */
export const resolveAiReviewContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: runIdParams,
  pathResolver: ({ runId }) => `/ai-review/runs/${runId}/resolve`,
  requestBodySchema: resolveAiReviewSchema,
  responsesByStatusCode: { 202: aiReviewRunSchema, ...errorResponses },
})

/**
 * Re-dispatch the slices of a review that never reported.
 *
 * The reviewer fans the diff out across parallel workers and emits its findings
 * in one final aggregation turn, which can wedge with every slice finished. This
 * recovers that without discarding the work: what gets redone is derived from
 * what the run observed, never supplied here. cat-factory bounds how many times
 * it will do it, and the curation reports the budget.
 */
export const resumeAiReviewContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: runIdParams,
  pathResolver: ({ runId }) => `/ai-review/runs/${runId}/resume`,
  // No body, and that IS the contract: which slices to redo is derived from what
  // the run observed, never supplied by the caller.
  requestBodySchema: v.object({}),
  responsesByStatusCode: { 202: aiReviewRunSchema, ...errorResponses },
})
