import * as v from 'valibot'
import { webUrlSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Merging a pull request from sainte-beuve: the state a host reports for one,
// and the merge comments an org posts to hand it to a merge bot.
//
// Imports nothing but vcs.ts: orgs.ts, teams.ts and projects.ts all read the
// comment schema, and none of them may be imported from here.
// ---------------------------------------------------------------------------

/**
 * A comment that asks a bot to merge, such as `/merge` for a merge queue.
 * `label` is the button; `body` is posted verbatim, because the bot parses it.
 */
export const mergeCommentSchema = v.object({
  label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)),
  body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2000)),
})
export type MergeComment = v.InferOutput<typeof mergeCommentSchema>

/** Short enough to stay a row of buttons. */
export const MAX_MERGE_COMMENTS = 10

export const mergeCommentListSchema = v.pipe(
  v.array(mergeCommentSchema),
  v.maxLength(MAX_MERGE_COMMENTS),
)

/**
 * A team's or a project's own list. Null inherits the level above it; an empty
 * list is a decision that this level has none.
 */
export const mergeCommentOverrideSchema = v.optional(v.nullable(mergeCommentListSchema), null)

/** Where the comments in force came from, most specific first. */
export const mergeCommentSourceSchema = v.picklist(['project', 'team', 'org'])
export type MergeCommentSource = v.InferOutput<typeof mergeCommentSourceSchema>

/**
 * Whether the reviewers the host asks for have signed off. GitLab reports no
 * change requests, so `changes_requested` only ever comes from GitHub.
 */
export const pullRequestApprovalSchema = v.picklist(['approved', 'changes_requested', 'pending'])
export type PullRequestApproval = v.InferOutput<typeof pullRequestApprovalSchema>

/**
 * Whether the host would merge it now. `blocked` covers every rule the host
 * enforces short of a conflict: missing approvals, failing required checks,
 * unresolved threads, a branch behind its base. `checking` is a host that has
 * not computed it yet, and reads again shortly.
 */
export const mergeabilitySchema = v.picklist([
  'mergeable',
  'blocked',
  'conflicting',
  'checking',
  'draft',
])
export type Mergeability = v.InferOutput<typeof mergeabilitySchema>

export const pullRequestStateSchema = v.picklist(['open', 'closed', 'merged'])
export type PullRequestState = v.InferOutput<typeof pullRequestStateSchema>

/** One pull request's review and merge state, read from its host on demand. */
export const pullRequestStatusSchema = v.object({
  state: pullRequestStateSchema,
  url: webUrlSchema,
  authorLogin: v.string(),
  draft: v.boolean(),
  approval: pullRequestApprovalSchema,
  mergeability: mergeabilitySchema,
  /** The commit a merge is checked against, so one that moved meanwhile is refused. */
  headSha: v.string(),
})
export type PullRequestStatus = v.InferOutput<typeof pullRequestStatusSchema>
