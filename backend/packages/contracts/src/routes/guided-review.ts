import { defineApiContract, sseResponse } from '@toad-contracts/valibot'
import * as v from 'valibot'
import {
  askGuidedReviewSchema,
  editGuidedReviewDraftSchema,
  guidedReviewCommentDraftSchema,
  guidedReviewExchangeSchema,
  guidedReviewPostResultSchema,
  guidedReviewSessionViewSchema,
  guidedReviewStreamEventSchema,
  guidedReviewTargetQuerySchema,
  guidedReviewTargetSchema,
  guidedReviewThreadViewSchema,
  openGuidedReviewThreadSchema,
  postGuidedReviewDraftsSchema,
  requestGuidedReviewDraftsSchema,
} from '../guided-review.js'
import { errorResponses, singleStringParam, stringParams } from './_shared.js'

// ---------------------------------------------------------------------------
// Guided review: cat-factory's deep dive into one pull request, relayed. See
// GuidedReviewController in @sainte-beuve/server.
//
// Every write answers with the state cat-factory persisted, at once: the
// overview and the answers are generated afterwards, and the session's stream
// says when they land. A screen that cannot hold the stream re-reads instead. The one route that
// reaches the pull request is the explicit post of named comment drafts.
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

/**
 * Edit a draft's body or line, or discard it. `rev` is the revision the edit
 * was made against: a draft that moved since is a 409 rather than overwritten.
 */
export const editGuidedReviewDraftContract = defineApiContract({
  method: 'patch',
  requestPathParamsSchema: stringParams('sessionId', 'draftId'),
  pathResolver: ({ sessionId, draftId }) =>
    `/guided-reviews/${sessionId}/comment-drafts/${draftId}`,
  requestBodySchema: editGuidedReviewDraftSchema,
  responsesByStatusCode: { 200: guidedReviewCommentDraftSchema, ...errorResponses },
})

/**
 * Post the named drafts on the pull request as plain review comments. Each
 * posts on its own, so the answer reports every draft, and a retry never posts
 * one twice. Refused while the pull request has commits past the reviewed one.
 */
export const postGuidedReviewDraftsContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: sessionParams,
  pathResolver: ({ sessionId }) => `/guided-reviews/${sessionId}/comment-drafts/post`,
  requestBodySchema: postGuidedReviewDraftsSchema,
  responsesByStatusCode: { 200: guidedReviewPostResultSchema, ...errorResponses },
})

/**
 * The session, live: its current view first, then a frame each time cat-factory
 * reports a change. The stream ends when cat-factory caps its own connection,
 * and the browser reconnects.
 */
export const streamGuidedReviewContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: sessionParams,
  pathResolver: ({ sessionId }) => `/guided-reviews/${sessionId}/stream`,
  responsesByStatusCode: {
    200: sseResponse({ guidedReview: guidedReviewStreamEventSchema }),
    ...errorResponses,
  },
})
