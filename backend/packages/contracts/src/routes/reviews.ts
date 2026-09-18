import { defineApiContract } from '@toad-contracts/valibot'
import * as v from 'valibot'
import {
  assignReviewersResultSchema,
  assignReviewersSchema,
  createReviewRequestSchema,
  reviewRequestSchema,
  reviewStatusSchema,
  updateReviewStatusSchema,
} from '../reviews.js'
import { errorResponses, singleStringParam } from './_shared.js'

// ---------------------------------------------------------------------------
// Review-request route contracts. See ReviewController in @sainte-beuve/server.
//
// Delegating a review to cat-factory and curating what it found are in
// `routes/ai-review.ts`, because that loop has its own run-addressed surface.
// ---------------------------------------------------------------------------

const reviewListSchema = v.object({ reviews: v.array(reviewRequestSchema) })
const reviewIdParams = singleStringParam('reviewId')

/**
 * The ceiling on one board read, which is also the ceiling a caller may ask for.
 *
 * A number rather than a cursor because the board is a screen somebody scans,
 * not a feed: the interesting rows are the newest, the ordering is total, and a
 * deployment that wants its history exports it. What matters here is that the
 * answer stops growing with the table — terminal reviews are never archived, so
 * an unbounded read got slower every week and re-parsed a payload per row that
 * nobody looked at.
 */
export const REVIEW_PAGE_LIMIT = 200

/**
 * `?status=open&status=assigned&limit=50`, both optional.
 *
 * The statuses accept BOTH shapes a query string can carry them in, and that is
 * not indulgence: a repeated parameter with a single value is indistinguishable
 * from a scalar once it is parsed, so a schema that took only the array would
 * refuse `?status=open`, and one that took only the string would refuse what
 * the client sends for two. The comma form is what a person writing the URL by
 * hand reaches for; the repeated form is what the typed client produces.
 *
 * The cap arrives as a string for the reason everything in a query string does,
 * and is bounded HERE rather than clamped in the controller: a caller asking
 * for a thousand rows has written something this API will not do, and answering
 * two hundred without saying so reads as a board that lost the rest.
 *
 * Refusing a bad value rather than ignoring it is the point of putting any of
 * this on the contract: `?status=merged` is somebody working from the wrong
 * vocabulary, and a filter that silently matched nothing would read as an empty
 * board.
 */
const reviewFilterSchema = v.object({
  status: v.optional(
    v.union([
      v.array(reviewStatusSchema),
      v.pipe(
        v.string(),
        v.transform((value) => value.split(',')),
        v.array(reviewStatusSchema),
      ),
    ]),
  ),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform(Number),
      v.number('limit must be a number'),
      v.integer(),
      v.minValue(1),
      v.maxValue(REVIEW_PAGE_LIMIT),
    ),
  ),
})

/**
 * The board. Unfiltered it answers the ACTIVE reviews, newest first, capped —
 * see `ReviewController` for where that default is applied and why it is not in
 * the schema: a default here would be indistinguishable, to a caller reading the
 * contract, from a filter they asked for.
 */
export const listReviewsContract = defineApiContract({
  method: 'get',
  requestQuerySchema: reviewFilterSchema,
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
