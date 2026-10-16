import * as v from 'valibot'
import { domainSchema } from './orgs.js'
import { skillSchema } from './reviewers.js'
import { dependencyBotsFilterSchema, openPullRequestSchema } from './vcs.js'
import { workspaceSourceSchema } from './workspace.js'

// ---------------------------------------------------------------------------
// PRs to review: the open pull requests in the linked repositories the viewer
// is best placed to review next, best first. The ones they committed to and
// have not reviewed yet lead; the rest are ranked on how long they have gone
// without a review and on how well the viewer fits them.
// ---------------------------------------------------------------------------

export const toReviewQuerySchema = v.object({
  dependencyBots: v.optional(dependencyBotsFilterSchema),
})
export type ToReviewQuery = v.InferOutput<typeof toReviewQuerySchema>

/** The most pull requests one read returns. */
export const MAX_PULL_REQUESTS_TO_REVIEW = 50

/** Why a pull request ranks where it does. */
export const toReviewReasonsSchema = v.object({
  /** When the viewer committed to reviewing it here, or null. Committed ones lead the list. */
  committedAt: v.nullable(v.number()),
  /** The viewer's commitment, which releasing it names. Null when they made none. */
  commitmentId: v.nullable(v.string()),
  /** The host is waiting on the viewer's review. */
  requested: v.boolean(),
  /** How many other people committed to reviewing it here. */
  othersCommitted: v.number(),
  /** The handles that have reviewed it, its author and bots left out. */
  reviewerLogins: v.array(v.string()),
  /** How long it has been open without a review, in milliseconds. Null once somebody reviewed it. */
  unreviewedForMs: v.nullable(v.number()),
  /** The repository's skills the viewer holds. */
  matchedSkills: v.array(skillSchema),
  /** The repository's domains the viewer knows. */
  matchedDomains: v.array(domainSchema),
  /** The share of the repository's skills and domains the viewer holds, from 0 to 1. */
  fit: v.number(),
  /** Reviews the viewer finished in the repository recently. */
  pastReviews: v.number(),
  /** Pull requests the viewer opened in the repository recently. */
  authored: v.number(),
})
export type ToReviewReasons = v.InferOutput<typeof toReviewReasonsSchema>

export const pullRequestToReviewSchema = v.object({
  ...openPullRequestSchema.entries,
  /** The linked project its repository is. */
  projectId: v.string(),
  /** The ranking score, higher first. Comparable within one read only. */
  score: v.number(),
  reasons: toReviewReasonsSchema,
})
export type PullRequestToReview = v.InferOutput<typeof pullRequestToReviewSchema>

export const pullRequestsToReviewSchema = v.object({
  /** Best first. */
  pullRequests: v.array(pullRequestToReviewSchema),
  sources: v.array(workspaceSourceSchema),
})
export type PullRequestsToReview = v.InferOutput<typeof pullRequestsToReviewSchema>
