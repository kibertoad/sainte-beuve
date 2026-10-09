import * as v from 'valibot'
import { reviewCommitmentSchema } from './attention.js'
import { openPullRequestSchema, repoOwnerSchema } from './vcs.js'
import { hostSearchSchema, workspaceScopeSchema, workspaceSourceSchema } from './workspace.js'

// ---------------------------------------------------------------------------
// My Reviews: the open pull requests other people opened that the viewer was
// asked to review, said they would review here, or has reviewed already.
// ---------------------------------------------------------------------------

export const myReviewsQuerySchema = v.object({
  scope: v.optional(workspaceScopeSchema),
  owner: v.optional(repoOwnerSchema),
})
export type MyReviewsQuery = v.InferOutput<typeof myReviewsQuerySchema>

/** Which registered project a row is in. Null for a repository nobody linked. */
const projectIdEntry = { projectId: v.nullable(v.string()) }

export const myReviewSchema = v.object({ ...openPullRequestSchema.entries, ...projectIdEntry })
export type MyReview = v.InferOutput<typeof myReviewSchema>

export const myReviewCommitmentSchema = v.object({
  ...reviewCommitmentSchema.entries,
  ...projectIdEntry,
})
export type MyReviewCommitment = v.InferOutput<typeof myReviewCommitmentSchema>

export const myReviewsSchema = v.object({
  /** The host has asked for the viewer's review and is still waiting on it. */
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
