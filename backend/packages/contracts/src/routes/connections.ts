import { defineApiContract } from '@toad-contracts/valibot'
import { connectionsSchema, connectStartSchema } from '../connections.js'
import { errorResponses } from './_shared.js'

// ---------------------------------------------------------------------------
// Connection route contracts. See ConnectionsController in @sainte-beuve/server.
// ---------------------------------------------------------------------------

export const getConnectionsContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/settings/connections',
  responsesByStatusCode: { 200: connectionsSchema, ...errorResponses },
})

/**
 * Where to install the GitHub App. A GET that MINTS something (a signed state
 * with a few minutes of life), which is why it is a separate route rather than a
 * field on the connection read: a status screen polling every few seconds would
 * otherwise mint a state per poll, and the one the operator eventually clicks
 * would be whichever poll happened last.
 */
export const startGitHubAppInstallContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/settings/connections/github/app-install',
  responsesByStatusCode: { 200: connectStartSchema, ...errorResponses },
})

/** Where to sign in with GitHub, for a deployment connecting by OAuth. */
export const startGitHubSignInContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/settings/connections/github/sign-in',
  responsesByStatusCode: { 200: connectStartSchema, ...errorResponses },
})

/**
 * Drop the credential a sign-in stored. Its own route rather than a DELETE on
 * the token store, because the sign-in credential is deliberately not one of the
 * pasteable ids: it has no text input to clear, and the screen's button here
 * means "disconnect this GitHub account" rather than "forget a token".
 */
export const disconnectGitHubSignInContract = defineApiContract({
  method: 'delete',
  pathResolver: () => '/settings/connections/github/sign-in',
  responsesByStatusCode: { 200: connectionsSchema, ...errorResponses },
})
