import { defineApiContract } from '@toad-contracts/valibot'
import {
  mergeMyPullRequestSchema,
  mergeOutcomeSchema,
  myPullRequestsQuerySchema,
  myPullRequestsSchema,
  postMergeCommentSchema,
} from '../my-pull-requests.js'
import { errorResponses } from './_shared.js'

// My PRs route contracts. See MyPullRequestsController in @sainte-beuve/server.
// Both writes act only on a pull request the caller authored.

export const listMyPullRequestsContract = defineApiContract({
  method: 'get',
  requestQuerySchema: myPullRequestsQuerySchema,
  pathResolver: () => '/my-pull-requests',
  responsesByStatusCode: { 200: myPullRequestsSchema, ...errorResponses },
})

export const mergeMyPullRequestContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/my-pull-requests/merge',
  requestBodySchema: mergeMyPullRequestSchema,
  responsesByStatusCode: { 200: mergeOutcomeSchema, ...errorResponses },
})

export const postMergeCommentContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/my-pull-requests/merge-comment',
  requestBodySchema: postMergeCommentSchema,
  responsesByStatusCode: { 200: mergeOutcomeSchema, ...errorResponses },
})
