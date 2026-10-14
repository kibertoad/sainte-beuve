// `@sainte-beuve/reporting`: how long pull requests wait for each review
// milestone, per repository and across an org, and which repositories stand
// out. Pure.

export { isAutomatedReviewer, KNOWN_AUTOMATED_REVIEWERS } from './automation.js'
export { findHotspots, MIN_HOTSPOT_SAMPLE, SLOW_FACTOR, STALLED_OVERDUE } from './hotspots.js'
export {
  metricsOf,
  type ReportedProject,
  type RepositoryTimelines,
  type TimedPullRequest,
} from './metrics.js'
export {
  isTimed,
  type MilestoneOutcome,
  type MilestoneOutcomes,
  humanReviews,
  milestonesOf,
  reviewsByOthers,
} from './milestones.js'
export {
  buildReviewReport,
  type ComputedReviewReport,
  type ReviewReportInput,
  windowStart,
} from './report.js'
export { type DirectoryEntry, peopleOf } from './people.js'
export { quantile, summarize } from './stats.js'
