import { defineApiContract } from '@toad-contracts/valibot'
import {
  declinedReviewRequestSchema,
  declineReviewRequestSchema,
  myReviewsQuerySchema,
  myReviewsSchema,
} from '../my-reviews.js'
import { errorResponses } from './_shared.js'

// My Reviews route contract. See MyReviewsController in @sainte-beuve/server.

export const listMyReviewsContract = defineApiContract({
  method: 'get',
  requestQuerySchema: myReviewsQuerySchema,
  pathResolver: () => '/my-reviews',
  responsesByStatusCode: { 200: myReviewsSchema, ...errorResponses },
})

/**
 * Refuse a review the viewer was asked for, on the host or by a teammate. The
 * row leaves "Asked to review", and whoever asked hears about it. A pull
 * request nobody is waiting on the viewer for any more answers with nothing
 * done rather than a refusal, since that is the state the caller wanted.
 */
export const declineReviewRequestContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/my-reviews/decline',
  requestBodySchema: declineReviewRequestSchema,
  responsesByStatusCode: { 200: declinedReviewRequestSchema, ...errorResponses },
})
