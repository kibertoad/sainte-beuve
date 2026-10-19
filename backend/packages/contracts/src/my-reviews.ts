import * as v from 'valibot'
import { dependencyBotsFilterSchema, openPullRequestSchema, repoOwnerSchema } from './vcs.js'
import {
  hostSearchSchema,
  placedCommitmentSchema,
  workspaceScopeSchema,
  workspaceSourceSchema,
} from './workspace.js'

// ---------------------------------------------------------------------------
// My Reviews: the open pull requests other people opened that the viewer was
// asked to review, said they would review here, or has reviewed already.
// ---------------------------------------------------------------------------

export const myReviewsQuerySchema = v.object({
  scope: v.optional(workspaceScopeSchema),
  owner: v.optional(repoOwnerSchema),
  dependencyBots: v.optional(dependencyBotsFilterSchema),
})
export type MyReviewsQuery = v.InferOutput<typeof myReviewsQuerySchema>

/** Which registered project a row is in. Null for a repository nobody linked. */
const projectIdEntry = { projectId: v.nullable(v.string()) }

/** A teammate's attention request naming the viewer, which they have not answered yet. */
export const myReviewAskSchema = v.object({
  attentionId: v.string(),
  requestedByName: v.string(),
  note: v.nullable(v.string()),
})
export type MyReviewAsk = v.InferOutput<typeof myReviewAskSchema>

export const myReviewSchema = v.object({
  ...openPullRequestSchema.entries,
  ...projectIdEntry,
  /** The ask behind a `requested` row, or null when only the host is waiting. */
  ask: v.optional(v.nullable(myReviewAskSchema), null),
})
export type MyReview = v.InferOutput<typeof myReviewSchema>

/** The same placed commitment the workspace lists. */
export const myReviewCommitmentSchema = placedCommitmentSchema
export type MyReviewCommitment = v.InferOutput<typeof myReviewCommitmentSchema>

export const myReviewsSchema = v.object({
  /**
   * The host has asked for the viewer's review and is still waiting on it, or
   * a teammate asked for it here by name. A pull request is listed once.
   */
  requested: v.array(myReviewSchema),
  /** Promises the viewer made here, whether or not the host knows about them. */
  committed: v.array(myReviewCommitmentSchema),
  /**
   * Still open, and the viewer has reviewed them. One the host asks them to
   * look at again is under `requested` instead.
   */
  reviewed: v.array(myReviewSchema),
  sources: v.array(workspaceSourceSchema),
  searches: v.array(hostSearchSchema),
})
export type MyReviews = v.InferOutput<typeof myReviewsSchema>
