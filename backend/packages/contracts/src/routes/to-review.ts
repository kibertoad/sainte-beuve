import { defineApiContract } from '@toad-contracts/valibot'
import { pullRequestsToReviewSchema } from '../to-review.js'
import { errorResponses } from './_shared.js'

// PRs to review route contract. See ToReviewController in @sainte-beuve/server.

export const listPullRequestsToReviewContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/to-review',
  responsesByStatusCode: { 200: pullRequestsToReviewSchema, ...errorResponses },
})
