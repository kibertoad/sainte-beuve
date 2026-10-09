import { defineApiContract } from '@toad-contracts/valibot'
import { myReviewsQuerySchema, myReviewsSchema } from '../my-reviews.js'
import { errorResponses } from './_shared.js'

// My Reviews route contract. See MyReviewsController in @sainte-beuve/server.

export const listMyReviewsContract = defineApiContract({
  method: 'get',
  requestQuerySchema: myReviewsQuerySchema,
  pathResolver: () => '/my-reviews',
  responsesByStatusCode: { 200: myReviewsSchema, ...errorResponses },
})
