import { defineApiContract } from '@toad-contracts/valibot'
import { viewerSchema } from '../identity.js'
import { workspaceSchema } from '../workspace.js'
import { errorResponses } from './_shared.js'

// ---------------------------------------------------------------------------
// Workspace route contracts. See WorkspaceController in @sainte-beuve/server.
// ---------------------------------------------------------------------------

/**
 * Who the caller is.
 *
 * There is no session yet (docs/implementation-plan.md, slice 6), so the viewer
 * is whoever the deployment's source-control credential acts as: the account
 * behind a sign-in, or behind a pasted token. A deployment authenticating as a
 * GitHub App acts as nobody, and this answers 503 saying so, because an App
 * installation is not a person and guessing one would be worse than refusing.
 */
export const getViewerContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/me',
  responsesByStatusCode: { 200: viewerSchema, ...errorResponses },
})

/** The three lists, from one sweep of the registered projects. */
export const getWorkspaceContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/workspace',
  responsesByStatusCode: { 200: workspaceSchema, ...errorResponses },
})
