import * as v from 'valibot'
import { reviewCommitmentSchema } from './attention.js'
import { viewerSchema } from './identity.js'
import { openPullRequestSchema, vcsProviderSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// The main working space: the three lists a person actually has to act on.
//
// One read rather than three. The lists are cuts of the same fetch (each host
// is asked once per project for its open pull requests), so splitting them into
// three routes would triple the rate-limit cost to answer one screen, and each
// answer would be from a different moment.
// ---------------------------------------------------------------------------

/**
 * Whether one registered project could be read, and why not when it could not.
 *
 * Reported per project rather than failing the whole call. A deployment
 * legitimately holds a GitHub credential and no GitLab one, or has been given a
 * token that cannot see one private repository, and a workspace that 503s
 * because of the second project is a workspace nobody can use for the first.
 */
export const workspaceSourceSchema = v.object({
  projectId: v.string(),
  provider: vcsProviderSchema,
  owner: v.string(),
  repo: v.string(),
  ok: v.boolean(),
  /** What went wrong, for the screen to show beside the project. Null when it read. */
  reason: v.nullable(v.string()),
})
export type WorkspaceSource = v.InferOutput<typeof workspaceSourceSchema>

export const workspaceSchema = v.object({
  viewer: viewerSchema,
  /** Open pull requests the viewer opened. */
  authored: v.array(openPullRequestSchema),
  /** Open pull requests the host has formally requested the viewer's review on. */
  reviewRequested: v.array(openPullRequestSchema),
  /**
   * Pull requests the viewer said they would review HERE. Distinct from the
   * list above and not a subset of it: committing through sainte-beuve is a
   * promise to a person, and it survives nobody having pressed the button on
   * the host.
   */
  committed: v.array(reviewCommitmentSchema),
  sources: v.array(workspaceSourceSchema),
})
export type Workspace = v.InferOutput<typeof workspaceSchema>
