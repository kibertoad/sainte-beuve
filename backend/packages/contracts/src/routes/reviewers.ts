import { defineApiContract } from '@toad-contracts/valibot'
import * as v from 'valibot'
import { recommendReviewersSchema, reviewerRecommendationsSchema } from '../recommendations.js'
import { createReviewerSchema, reviewerSchema, updateReviewerSchema } from '../reviewers.js'
import { errorResponses, singleStringParam } from './_shared.js'

// ---------------------------------------------------------------------------
// Reviewer-directory route contracts. See ReviewerController in
// @sainte-beuve/server.
// ---------------------------------------------------------------------------

const reviewerListSchema = v.object({ reviewers: v.array(reviewerSchema) })
const reviewerIdParams = singleStringParam('reviewerId')

export const listReviewersContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/reviewers',
  responsesByStatusCode: { 200: reviewerListSchema, ...errorResponses },
})

export const createReviewerContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/reviewers',
  requestBodySchema: createReviewerSchema,
  responsesByStatusCode: { 201: reviewerSchema, ...errorResponses },
})

export const updateReviewerContract = defineApiContract({
  method: 'patch',
  requestPathParamsSchema: reviewerIdParams,
  pathResolver: ({ reviewerId }) => `/reviewers/${reviewerId}`,
  requestBodySchema: updateReviewerSchema,
  responsesByStatusCode: { 200: reviewerSchema, ...errorResponses },
})

/**
 * Who fits a pull request best, ranked. A POST because the question carries a
 * pull request and a skill list, not because it writes anything.
 */
export const recommendReviewersContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/reviewers/recommendations',
  requestBodySchema: recommendReviewersSchema,
  responsesByStatusCode: { 200: reviewerRecommendationsSchema, ...errorResponses },
})
