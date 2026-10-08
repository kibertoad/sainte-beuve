import * as v from 'valibot'
import {
  mergeCommentListSchema,
  mergeCommentSchema,
  mergeCommentSourceSchema,
  pullRequestStatusSchema,
} from './merging.js'
import { openPullRequestSchema, repoOwnerSchema, vcsProviderSchema } from './vcs.js'
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

/**
 * Which repositories to look in. `all` is the default: the registered projects,
 * and whatever else the host finds the viewer authored. `linked` is the
 * registered projects alone. Naming a `projectId` implies `linked`.
 */
export const myPullRequestScopeSchema = v.picklist(['all', 'linked'])
export type MyPullRequestScope = v.InferOutput<typeof myPullRequestScopeSchema>

export const myPullRequestsQuerySchema = v.object({
  status: v.optional(myPullRequestStatusFilterSchema),
  scope: v.optional(myPullRequestScopeSchema),
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
 * - `unlinked`: the repository is not a registered project, so nothing here
 *   merges it until somebody links it.
 */
export const directMergeSchema = v.picklist([
  'allowed',
  'not_mergeable',
  'restricted',
  'override',
  'unlinked',
])
export type DirectMerge = v.InferOutput<typeof directMergeSchema>

export const myPullRequestSchema = v.object({
  ...openPullRequestSchema.entries,
  /** Null for a pull request in a repository that is not a registered project. */
  projectId: v.nullable(v.string()),
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

/** Whether a host could be searched for the viewer's pull requests, and why not. */
export const hostSearchSchema = v.object({
  provider: vcsProviderSchema,
  ok: v.boolean(),
  reason: v.nullable(v.string()),
})
export type HostSearch = v.InferOutput<typeof hostSearchSchema>

export const myPullRequestsSchema = v.object({
  pullRequests: v.array(myPullRequestSchema),
  /**
   * False when the view stopped reading statuses before it found
   * {@link MY_PULL_REQUESTS_LIMIT} matches, so older ones may be missing.
   */
  complete: v.boolean(),
  sources: v.array(workspaceSourceSchema),
  /** One per host searched for pull requests outside the registered projects. */
  searches: v.array(hostSearchSchema),
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
