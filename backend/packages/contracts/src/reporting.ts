import * as v from 'valibot'
import { vcsProviderSchema } from './vcs.js'
import { workspaceSourceSchema } from './workspace.js'

// ---------------------------------------------------------------------------
// Reports: how long the pull requests opened in a window waited for each review
// milestone, across the org's linked repositories or in one of them, and which
// repositories are the hotspots.
// ---------------------------------------------------------------------------

/**
 * The milestones a pull request is timed to, each measured from the moment it
 * was ready for review (opened, or last marked ready after a draft):
 *
 * - `first_review`: the first review by anybody but its author, bots included.
 * - `first_human_review`: the same, with bots and AI reviewers left out.
 * - `approval`: the first approval by anybody but its author.
 * - `merge`: when it merged.
 */
export const reviewMilestoneSchema = v.picklist([
  'first_review',
  'first_human_review',
  'approval',
  'merge',
])
export type ReviewMilestone = v.InferOutput<typeof reviewMilestoneSchema>

export const REVIEW_MILESTONES: readonly ReviewMilestone[] = reviewMilestoneSchema.options

/** The windows a report can cover, in days, as the query spells them. */
export const reportWindowSchema = v.picklist(['7', '14', '30', '90'])
export type ReportWindow = v.InferOutput<typeof reportWindowSchema>

export const DEFAULT_REPORT_WINDOW: ReportWindow = '30'

export const reviewReportQuerySchema = v.object({
  /** How many days back the pull requests were opened. 30 when left out. */
  days: v.optional(reportWindowSchema),
  /** One linked project. Left out, the report covers every linked repository. */
  projectId: v.optional(v.pipe(v.string(), v.minLength(1))),
})
export type ReviewReportQuery = v.InferOutput<typeof reviewReportQuerySchema>

/** How long one milestone took, over the pull requests that reached it. */
export const milestoneStatsSchema = v.object({
  /** Pull requests that reached the milestone. The durations below are over these. */
  reached: v.number(),
  /**
   * Open, ready pull requests still short of it. Not in the durations, which
   * would read faster than they are if these were left unsaid.
   */
  waiting: v.number(),
  /** Null when nothing reached it. All durations are in milliseconds. */
  medianMs: v.nullable(v.number()),
  p90Ms: v.nullable(v.number()),
  meanMs: v.nullable(v.number()),
})
export type MilestoneStats = v.InferOutput<typeof milestoneStatsSchema>

export const reviewMetricsSchema = v.object({
  first_review: milestoneStatsSchema,
  first_human_review: milestoneStatsSchema,
  approval: milestoneStatsSchema,
  merge: milestoneStatsSchema,
})
export type ReviewMetrics = v.InferOutput<typeof reviewMetricsSchema>

/**
 * Why a repository is a hotspot on a milestone: its median is well above the
 * whole report's (`slow`), or several of its open pull requests have waited
 * longer than nearly everything that did reach it (`stalled`), which a median
 * over the ones that made it cannot show.
 */
export const hotspotReasonSchema = v.picklist(['slow', 'stalled'])
export type HotspotReason = v.InferOutput<typeof hotspotReasonSchema>

export const hotspotSchema = v.object({
  projectId: v.string(),
  milestone: reviewMilestoneSchema,
  reason: hotspotReasonSchema,
  /** The repository's median, or null when nothing in it reached the milestone. */
  medianMs: v.nullable(v.number()),
  /** The whole report's median, for comparison. */
  overallMedianMs: v.nullable(v.number()),
  /**
   * The repository's open pull requests that have waited for the milestone
   * longer than the whole report's p90 (a day when nothing reached it).
   */
  overdue: v.number(),
})
export type Hotspot = v.InferOutput<typeof hotspotSchema>

export const repositoryReportSchema = v.object({
  projectId: v.string(),
  provider: vcsProviderSchema,
  owner: v.string(),
  repo: v.string(),
  /** Pull requests opened in the window, drafts that never left draft excepted. */
  pullRequests: v.number(),
  metrics: reviewMetricsSchema,
})
export type RepositoryReport = v.InferOutput<typeof repositoryReportSchema>

/** One pull request still waiting on a human review, or the longest it waited. */
export const slowPullRequestSchema = v.object({
  projectId: v.string(),
  number: v.number(),
  title: v.string(),
  url: v.string(),
  authorLogin: v.nullable(v.string()),
  /** When it was ready for review. */
  readyAt: v.number(),
  /** How long it waited for a human review, or has waited so far. */
  waitMs: v.number(),
  /** Still open with no human review. */
  waiting: v.boolean(),
})
export type SlowPullRequest = v.InferOutput<typeof slowPullRequestSchema>

/**
 * One person's part in a report: the reviews they gave on the pull requests
 * opened in the window, and how quickly the ones they opened were reviewed.
 * Keyed by their handle on one host; bots and AI reviewers are not people here.
 */
export const personReportSchema = v.object({
  provider: vcsProviderSchema,
  login: v.string(),
  /** The directory row whose handle on this host it is, or null when nobody claims it. */
  reviewerId: v.nullable(v.string()),
  displayName: v.nullable(v.string()),
  /** Pull requests by somebody else they reviewed, each counted once. */
  reviewed: v.number(),
  /** Of those, the ones they approved. */
  approved: v.number(),
  /** Of those, the ones where theirs was the first human review. */
  firstToReview: v.number(),
  /** Pull requests they opened in the window, drafts left out. */
  authored: v.number(),
  /** The milestones of the pull requests they opened. */
  authoredMetrics: reviewMetricsSchema,
  /**
   * How long the longest-waiting of their pull requests still without a human
   * review has waited so far, or null when none is waiting.
   */
  longestWaitingMs: v.nullable(v.number()),
})
export type PersonReport = v.InferOutput<typeof personReportSchema>

/** The most slow pull requests one report lists. */
export const MAX_SLOW_PULL_REQUESTS = 10

export const reviewReportSchema = v.object({
  days: v.number(),
  /** The start of the window: pull requests opened from here on are counted. */
  since: v.number(),
  generatedAt: v.number(),
  /** The project the report is narrowed to, or null for every linked repository. */
  projectId: v.nullable(v.string()),
  pullRequests: v.number(),
  metrics: reviewMetricsSchema,
  /**
   * Every repository the host answered for, most pull requests first. One it
   * would not read is only in `sources`, since it has no numbers to show.
   */
  repositories: v.array(repositoryReportSchema),
  /** Worst first. Empty for a report on one repository, which has nothing to stand out from. */
  hotspots: v.array(hotspotSchema),
  /** Everybody who reviewed or opened a pull request in the window, most reviews first. */
  people: v.array(personReportSchema),
  /** The longest waits for a human review, longest first. */
  slowest: v.array(slowPullRequestSchema),
  /** Per repository, whether it could be read, and whether the read stopped short of the window. */
  sources: v.array(
    v.object({
      ...workspaceSourceSchema.entries,
      /** The host's history ran past what one read follows, so the oldest part of the window is missing. */
      truncated: v.boolean(),
    }),
  ),
})
export type ReviewReport = v.InferOutput<typeof reviewReportSchema>
