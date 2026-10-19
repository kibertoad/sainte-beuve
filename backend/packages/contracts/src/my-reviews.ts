import * as v from 'valibot'
import { declineAttentionRequestSchema } from './attention.js'
import {
  dependencyBotsFilterSchema,
  openPullRequestSchema,
  pullRequestRefSchema,
  repoOwnerSchema,
} from './vcs.js'
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

/**
 * "Not me" on a row of `requested`: the host's request taken back off the
 * viewer, and every open ask on the pull request that still waits on them
 * declined. The title is what the author is told the refusal was about.
 */
export const declineReviewRequestSchema = v.object({
  pullRequest: pullRequestRefSchema,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
  ...declineAttentionRequestSchema.entries,
})
export type DeclineReviewRequest = v.InferOutput<typeof declineReviewRequestSchema>

/** Where the author heard about a refusal of the host's request. */
export const reviewDeclineNoticeSchema = v.picklist(['chat', 'comment', 'none'])
export type ReviewDeclineNotice = v.InferOutput<typeof reviewDeclineNoticeSchema>

export const declinedReviewRequestSchema = v.object({
  /** The host was waiting on the viewer, and no longer is. */
  withdrawnOnHost: v.boolean(),
  /** The asks the decline answered. Their requesters see it on the ask itself. */
  declinedAttentionIds: v.array(v.string()),
  /**
   * How the pull request's author was told the host's request was refused: a
   * DM, or a comment on the pull request when they have no Slack id here.
   * `none` when there was no host request, or neither reached them.
   */
  authorNotice: reviewDeclineNoticeSchema,
})
export type DeclinedReviewRequest = v.InferOutput<typeof declinedReviewRequestSchema>
