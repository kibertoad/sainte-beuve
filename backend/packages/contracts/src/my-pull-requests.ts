import * as v from 'valibot'
import {
  mergeCommentListSchema,
  mergeCommentSchema,
  mergeCommentSourceSchema,
  pullRequestStatusSchema,
} from './merging.js'
import { openPullRequestSchema, repoOwnerSchema } from './vcs.js'
import { workspaceSourceSchema } from './workspace.js'

// ---------------------------------------------------------------------------
// My PRs: the viewer's own open pull requests, with what it takes to merge each.
// ---------------------------------------------------------------------------

/** How many pull requests the view lists. */
export const MY_PULL_REQUESTS_LIMIT = 10

/**
 * Which of the viewer's pull requests to list. `awaiting` is the default: not a
 * draft and not approved yet, which is what still needs somebody else.
 */
export const myPullRequestStatusFilterSchema = v.picklist(['awaiting', 'approved', 'draft'])
export type MyPullRequestStatusFilter = v.InferOutput<typeof myPullRequestStatusFilterSchema>

export const myPullRequestsQuerySchema = v.object({
  status: v.optional(myPullRequestStatusFilterSchema),
  owner: v.optional(repoOwnerSchema),
  projectId: v.optional(v.pipe(v.string(), v.minLength(1))),
})
export type MyPullRequestsQuery = v.InferOutput<typeof myPullRequestsQuerySchema>

/**
 * Whether the viewer may merge it from here.
 *
 * - `allowed`: the host says it is mergeable and nothing here stands in the way.
 * - `not_mergeable`: the host would refuse it; `mergeability` on the status says why.
 * - `restricted`: the project sends merges through its merge comments.
 * - `override`: restricted, but the viewer is an admin and may merge anyway
 *   after confirming it.
 */
export const directMergeSchema = v.picklist(['allowed', 'not_mergeable', 'restricted', 'override'])
export type DirectMerge = v.InferOutput<typeof directMergeSchema>

export const myPullRequestSchema = v.object({
  ...openPullRequestSchema.entries,
  projectId: v.string(),
  /** Null when the host could not be asked; `statusError` says why. */
  status: v.nullable(pullRequestStatusSchema),
  statusError: v.nullable(v.string()),
  merge: v.object({
    direct: directMergeSchema,
    comments: mergeCommentListSchema,
    /** Null when no level configures any. */
    commentsFrom: v.nullable(mergeCommentSourceSchema),
  }),
})
export type MyPullRequest = v.InferOutput<typeof myPullRequestSchema>

export const myPullRequestsSchema = v.object({
  pullRequests: v.array(myPullRequestSchema),
  /**
   * False when the view stopped reading statuses before it found
   * {@link MY_PULL_REQUESTS_LIMIT} matches, so older ones may be missing.
   */
  complete: v.boolean(),
  sources: v.array(workspaceSourceSchema),
})
export type MyPullRequests = v.InferOutput<typeof myPullRequestsSchema>

/** Which pull request an action is about: a registered project and its number there. */
const pullRequestTargetEntries = {
  projectId: v.pipe(v.string(), v.minLength(1)),
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
}

export const mergeMyPullRequestSchema = v.object({
  ...pullRequestTargetEntries,
  /** The head the caller saw. A pull request that moved since is refused rather than merged. */
  expectedHeadSha: v.pipe(v.string(), v.minLength(1)),
  /** An admin confirming a merge the project restricts to its merge comments. */
  override: v.optional(v.boolean(), false),
})
export type MergeMyPullRequest = v.InferOutput<typeof mergeMyPullRequestSchema>
export type MergeMyPullRequestInput = v.InferInput<typeof mergeMyPullRequestSchema>

/** The comment to post, which must be one of those in force for the pull request. */
export const postMergeCommentSchema = v.object({
  ...pullRequestTargetEntries,
  comment: mergeCommentSchema,
})
export type PostMergeComment = v.InferOutput<typeof postMergeCommentSchema>

export const mergeOutcomeSchema = v.object({
  outcome: v.picklist(['merged', 'commented']),
})
export type MergeOutcome = v.InferOutput<typeof mergeOutcomeSchema>
