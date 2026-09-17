import { defineApiContract, withObjectKeys } from '@toad-contracts/valibot'
import * as v from 'valibot'
import {
  apiKeyListSchema,
  authStateSchema,
  createApiKeyInputSchema,
  issuedApiKeySchema,
} from '../auth.js'
import { connectStartSchema } from '../connections.js'
import { orgSlugSchema } from '../orgs.js'
import { vcsProviderSchema } from '../vcs.js'
import { errorResponses, singleStringParam } from './_shared.js'

// ---------------------------------------------------------------------------
// Authentication route contracts. See AuthController in @sainte-beuve/server.
//
// They sit in two places on purpose. `/auth/*` is what a browser needs before it
// can render anything, and it has to be reachable by a caller who cannot yet
// prove anything — the whole point of the state read is to be told you are
// nobody. The API KEYS are under `/settings` with the credential routes instead,
// because minting one produces a credential, and the settings prefix is what the
// wildcard CORS default already stops at (see `allowedOrigin` in app.ts).
// ---------------------------------------------------------------------------

const providerParams = withObjectKeys(v.object({ provider: vcsProviderSchema }))

/**
 * Who am I, and does this deployment care?
 *
 * Never refused, in either mode: a screen that had to be signed in to find out
 * that it is not signed in has nowhere to start. It answers
 * `{ kind: 'anonymous' }` and the sign-in routes it could use instead.
 */
export const getAuthStateContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/auth/session',
  responsesByStatusCode: { 200: authStateSchema, ...errorResponses },
})

/**
 * Start a sign-in that establishes a SESSION and stores nothing.
 *
 * Deliberately a different route from the one on the Configuration screen, over
 * the same OAuth client and the same callback: that one connects the
 * DEPLOYMENT's credential, which is an operator's act on shared state, and this
 * one proves who the caller is. One route for both would mean everybody who
 * signed in overwrote the repository credential the board runs on.
 */
export const startSessionSignInContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: providerParams,
  /**
   * Which tenancy to sign in to. Omitted means the default org, which is every
   * request on a deployment that never made a second one.
   *
   * It is on the SIGN-IN and nowhere else, and that is the whole of how an org
   * is chosen: the session that comes back is bound to it, and every later
   * request takes its org from the session rather than from anything the caller
   * sends. A route that accepted an org would be a boundary a caller can cross.
   */
  requestQuerySchema: v.object({ org: v.optional(orgSlugSchema) }),
  pathResolver: ({ provider }) => `/auth/sign-in/${provider}`,
  responsesByStatusCode: { 200: connectStartSchema, ...errorResponses },
})

/**
 * Drop this session. A POST rather than a DELETE because it acts on the caller's
 * own cookie rather than on a resource anybody can address, and the answer is
 * the auth state again, so the screen re-renders from what the server says
 * rather than from what it assumes happened.
 */
export const signOutContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/auth/sign-out',
  requestBodySchema: v.object({}),
  responsesByStatusCode: { 200: authStateSchema, ...errorResponses },
})

export const listApiKeysContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/settings/api-keys',
  responsesByStatusCode: { 200: apiKeyListSchema, ...errorResponses },
})

/** 201 with the key in it, which is the one and only time it is readable. */
export const createApiKeyContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/settings/api-keys',
  requestBodySchema: createApiKeyInputSchema,
  responsesByStatusCode: { 201: issuedApiKeySchema, ...errorResponses },
})

/** The remaining keys, not an acknowledgement: the screen re-renders from the answer. */
export const revokeApiKeyContract = defineApiContract({
  method: 'delete',
  requestPathParamsSchema: singleStringParam('keyId'),
  pathResolver: ({ keyId }) => `/settings/api-keys/${keyId}`,
  responsesByStatusCode: { 200: apiKeyListSchema, ...errorResponses },
})
