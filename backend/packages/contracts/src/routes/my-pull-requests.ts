import { defineApiContract } from '@toad-contracts/valibot'
import {
  conflictResolutionSchema,
  mergeMyPullRequestSchema,
  mergeOutcomeSchema,
  myPullRequestsQuerySchema,
  myPullRequestsSchema,
  postMergeCommentSchema,
  resolveConflictsSchema,
} from '../my-pull-requests.js'
import { errorResponses } from './_shared.js'

// My PRs route contracts. See MyPullRequestsController in @sainte-beuve/server.
// Every write acts only on a pull request the caller authored.

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

/**
 * Hand a pull request whose branch conflicts with its base to cat-factory's
 * conflict resolver, which pushes its resolution to that branch. Answers once
 * cat-factory has accepted the task, not once the conflicts are resolved.
 */
export const resolveConflictsContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/my-pull-requests/resolve-conflicts',
  requestBodySchema: resolveConflictsSchema,
  responsesByStatusCode: { 200: conflictResolutionSchema, ...errorResponses },
})
