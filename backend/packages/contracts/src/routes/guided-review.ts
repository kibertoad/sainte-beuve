import { defineApiContract } from '@toad-contracts/valibot'
import * as v from 'valibot'
import {
  askGuidedReviewSchema,
  guidedReviewExchangeSchema,
  guidedReviewSessionViewSchema,
  guidedReviewTargetQuerySchema,
  guidedReviewTargetSchema,
  guidedReviewThreadViewSchema,
  openGuidedReviewThreadSchema,
  requestGuidedReviewDraftsSchema,
} from '../guided-review.js'
import { errorResponses, singleStringParam, stringParams } from './_shared.js'

// ---------------------------------------------------------------------------
// Guided review: cat-factory's deep dive into one pull request, relayed. See
// GuidedReviewController in @sainte-beuve/server.
//
// Every write answers with the state cat-factory persisted, at once: the
// overview and the answers are generated afterwards, so a screen re-reads the
// session or the thread until nothing in it is pending. Nothing here posts to
// the pull request.
// ---------------------------------------------------------------------------

const sessionParams = singleStringParam('sessionId')
const threadParams = stringParams('sessionId', 'threadId')

/**
 * The guided review this deployment already holds for a pull request, or null.
 *
 * Its own read because opening one spends model budget: a screen asks this
 * first, and offers to open only when the answer is null.
 */
export const findGuidedReviewContract = defineApiContract({
  method: 'get',
  requestQuerySchema: guidedReviewTargetQuerySchema,
  pathResolver: () => '/guided-reviews',
  responsesByStatusCode: {
    200: v.object({ session: v.nullable(guidedReviewSessionViewSchema) }),
    ...errorResponses,
  },
})

/** Open a guided review of a pull request, or answer with the one already open. */
export const openGuidedReviewContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/guided-reviews',
  requestBodySchema: guidedReviewTargetSchema,
  responsesByStatusCode: { 200: guidedReviewSessionViewSchema, ...errorResponses },
})

export const getGuidedReviewContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: sessionParams,
  pathResolver: ({ sessionId }) => `/guided-reviews/${sessionId}`,
  responsesByStatusCode: { 200: guidedReviewSessionViewSchema, ...errorResponses },
})

/**
 * Regenerate the overview at the pull request's current head.
 *
 * What a review whose author has pushed since needs: every answer and anchor
 * was computed against the commit it was opened on. The threads are kept.
 */
export const refreshGuidedReviewContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: sessionParams,
  pathResolver: ({ sessionId }) => `/guided-reviews/${sessionId}/refresh`,
  requestBodySchema: v.object({}),
  responsesByStatusCode: { 200: guidedReviewSessionViewSchema, ...errorResponses },
})

/** Open a thread, asking its first question when one is given. */
export const openGuidedReviewThreadContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: sessionParams,
  pathResolver: ({ sessionId }) => `/guided-reviews/${sessionId}/threads`,
  requestBodySchema: openGuidedReviewThreadSchema,
  responsesByStatusCode: { 200: guidedReviewThreadViewSchema, ...errorResponses },
})

export const getGuidedReviewThreadContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: threadParams,
  pathResolver: ({ sessionId, threadId }) => `/guided-reviews/${sessionId}/threads/${threadId}`,
  responsesByStatusCode: { 200: guidedReviewThreadViewSchema, ...errorResponses },
})

/**
 * Ask a follow-up in a thread. A thread holds one answer in flight, so asking
 * while one is pending is a 409.
 */
export const askGuidedReviewContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: threadParams,
  pathResolver: ({ sessionId, threadId }) =>
    `/guided-reviews/${sessionId}/threads/${threadId}/messages`,
  requestBodySchema: askGuidedReviewSchema,
  responsesByStatusCode: { 200: guidedReviewExchangeSchema, ...errorResponses },
})

/** Ask for review comments drafted from what a thread concluded. */
export const requestGuidedReviewDraftsContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: threadParams,
  pathResolver: ({ sessionId, threadId }) =>
    `/guided-reviews/${sessionId}/threads/${threadId}/comment-drafts`,
  requestBodySchema: requestGuidedReviewDraftsSchema,
  responsesByStatusCode: { 200: guidedReviewExchangeSchema, ...errorResponses },
})
