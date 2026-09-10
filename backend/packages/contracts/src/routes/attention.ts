import { defineApiContract, sseResponse } from '@toad-contracts/valibot'
import * as v from 'valibot'
import {
  attentionEventSchema,
  attentionInboxSchema,
  attentionRequestSchema,
  createAttentionRequestSchema,
  createReviewCommitmentSchema,
  reviewCommitmentSchema,
} from '../attention.js'
import { errorResponses, singleStringParam } from './_shared.js'

// ---------------------------------------------------------------------------
// Attention route contracts. See AttentionController in @sainte-beuve/server.
//
// Two ways to receive the same thing, deliberately. `streamAttentionContract`
// pushes to a page that is already open; `listAttentionContract` answers the
// page that opened an hour later. Neither is a fallback for the other in the
// sense of being second-best: a stream reaches nobody who is not connected, and
// a poll cannot be instant, and a workspace has to serve both people.
// ---------------------------------------------------------------------------

const attentionIdParams = singleStringParam('attentionId')

/** Everything still open and addressed to the caller. */
export const listAttentionContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/attention',
  responsesByStatusCode: { 200: attentionInboxSchema, ...errorResponses },
})

/**
 * The live half. Server-sent events rather than a socket: the traffic is one
 * way, an `EventSource` reconnects by itself, and it survives the proxies a
 * corporate network puts in front of a deployment.
 */
export const streamAttentionContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/attention/stream',
  responsesByStatusCode: {
    200: sseResponse({ attention: attentionEventSchema }),
    ...errorResponses,
  },
})

export const requestAttentionContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/attention',
  requestBodySchema: createAttentionRequestSchema,
  responsesByStatusCode: { 201: attentionRequestSchema, ...errorResponses },
})

/**
 * "I will review it." Returns the request rather than the commitment, because
 * what the presser needs to know is whether that answered it: the same click
 * either adds one more name or closes the ask for everybody.
 */
export const commitToAttentionContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: attentionIdParams,
  pathResolver: ({ attentionId }) => `/attention/${attentionId}/commit`,
  requestBodySchema: v.object({}),
  responsesByStatusCode: { 200: attentionRequestSchema, ...errorResponses },
})

/** The requester withdrawing: the pull request merged, or stopped needing eyes. */
export const cancelAttentionContract = defineApiContract({
  method: 'delete',
  requestPathParamsSchema: attentionIdParams,
  pathResolver: ({ attentionId }) => `/attention/${attentionId}`,
  responsesByStatusCode: { 200: attentionRequestSchema, ...errorResponses },
})

/** Commit to a pull request nobody raised an attention request for. */
export const commitToPullRequestContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/commitments',
  requestBodySchema: createReviewCommitmentSchema,
  responsesByStatusCode: { 201: reviewCommitmentSchema, ...errorResponses },
})

/** Hand it back. The promise was to a person, so withdrawing it is explicit. */
export const releaseCommitmentContract = defineApiContract({
  method: 'delete',
  requestPathParamsSchema: singleStringParam('commitmentId'),
  pathResolver: ({ commitmentId }) => `/commitments/${commitmentId}`,
  responsesByStatusCode: {
    200: v.object({ commitments: v.array(reviewCommitmentSchema) }),
    ...errorResponses,
  },
})
