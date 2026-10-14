import type { ReviewReport } from '@sainte-beuve/contracts'

/** One org's review report, as the metrics export publishes it. */
export interface OrgReviewReport {
  org: { id: string; slug: string }
  report: ReviewReport
}

/**
 * Publishes the review metrics somewhere outside the process: an OpenTelemetry
 * collector, in the one adapter there is. One call per export pass, carrying
 * every org's report, so a pass is one push however many tenancies there are.
 */
export interface ReviewMetricsExporter {
  export(reports: readonly OrgReviewReport[]): Promise<void>
}
