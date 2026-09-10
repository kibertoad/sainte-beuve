import { defineApiContract } from '@toad-contracts/valibot'
import * as v from 'valibot'
import { aiReviewRunSchema, requestAiReviewSchema } from '../ai-review.js'
import {
  assignReviewersResultSchema,
  assignReviewersSchema,
  createReviewRequestSchema,
  reviewRequestSchema,
  updateReviewStatusSchema,
} from '../reviews.js'
import { errorResponses, singleStringParam } from './_shared.js'

// ---------------------------------------------------------------------------
// Review-request route contracts. See ReviewController in @sainte-beuve/server.
// ---------------------------------------------------------------------------

const reviewListSchema = v.object({ reviews: v.array(reviewRequestSchema) })
const reviewIdParams = singleStringParam('reviewId')

export const listReviewsContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/reviews',
  responsesByStatusCode: { 200: reviewListSchema, ...errorResponses },
})

export const createReviewContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/reviews',
  requestBodySchema: createReviewRequestSchema,
  responsesByStatusCode: { 201: reviewRequestSchema, ...errorResponses },
})

export const getReviewContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}`,
  responsesByStatusCode: { 200: reviewRequestSchema, ...errorResponses },
})

export const updateReviewStatusContract = defineApiContract({
  method: 'patch',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}/status`,
  requestBodySchema: updateReviewStatusSchema,
  responsesByStatusCode: { 200: reviewRequestSchema, ...errorResponses },
})

/** Hand the review to reviewers the router picks. Idempotent only in the trivial sense: a
 * second call adds MORE reviewers, it does not re-run the first pick. */
export const assignReviewersContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}/assign`,
  requestBodySchema: assignReviewersSchema,
  responsesByStatusCode: { 200: assignReviewersResultSchema, ...errorResponses },
})

export const requestAiReviewContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}/ai-review`,
  requestBodySchema: requestAiReviewSchema,
  responsesByStatusCode: { 202: aiReviewRunSchema, ...errorResponses },
})

export const listAiReviewRunsContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}/ai-review`,
  responsesByStatusCode: { 200: v.object({ runs: v.array(aiReviewRunSchema) }), ...errorResponses },
})
