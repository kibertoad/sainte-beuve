import type { PublicDecisionList, PublicPrReviewDecision } from '@cat-factory/sdk'
import type { AiReviewCuration, AiReviewFinding, AiReviewPostReport } from '@sainte-beuve/contracts'

/**
 * cat-factory's parked `pr-review` decision, projected onto the AI-review port.
 *
 * A projection rather than a re-export of the SDK's own type, for the reason the
 * contracts package exists: the SPA renders these fields, and passing an upstream
 * model straight through would put a cat-factory version bump on the wire between
 * two halves of sainte-beuve. What is dropped is dropped on purpose: the slice
 * bodies (their titles and paths say nothing a curator acts on, and the counts are
 * what a stall is judged from) and the challenge state, which needs a verb this
 * loop does not offer.
 */

/**
 * The decision a run is parked on, or null when it carries none.
 *
 * Null is the ordinary answer twice over: while the reviewer is still working
 * nothing is parked, and once a pass settles the decision LEAVES the list with
 * the loop it belongs to. Neither is a fault, so neither throws.
 */
function prReviewDecisionOf(list: PublicDecisionList): PublicPrReviewDecision | null {
  return list.decisions.find((entry) => entry.kind === 'pr-review') ?? null
}

/** The findings a curator picks from, in the order cat-factory prioritised them. */
function findingsOf(decision: PublicPrReviewDecision): AiReviewFinding[] {
  return decision.findings.map((finding) => ({
    findingId: finding.findingId,
    title: finding.title,
    detail: finding.detail,
    path: finding.path,
    line: finding.line,
    side: finding.side,
    severity: finding.severity,
    category: finding.category,
    suggestedFix: finding.suggestedFix,
  }))
}

/** The receipt for the last posting pass, when there has been one. */
function postReportOf(decision: PublicPrReviewDecision): AiReviewPostReport | null {
  const report = decision.postReport
  if (report === null) return null
  return {
    attempt: report.attempt,
    attempted: report.attempted,
    posted: report.posted,
    folded: report.folded,
    bodyPosted: report.bodyPosted,
    bodyError: report.bodyError,
    failures: report.failures.map((failure) => ({
      findingId: failure.findingId,
      path: failure.path,
      line: failure.line,
      reason: failure.reason,
    })),
  }
}

function toCuration(decision: PublicPrReviewDecision): AiReviewCuration {
  return {
    status: decision.status,
    findings: findingsOf(decision),
    selectedFindingIds: [...decision.selectedFindingIds],
    postedFindingIds: [...decision.postedFindingIds],
    postedBody: decision.postedBody,
    postAttempts: decision.postAttempts,
    postReport: postReportOf(decision),
    // Flattened to a count, because what a caller decides on is whether every
    // slice is in: the reviewer emits its findings in one final aggregation turn,
    // and `reportedSliceCount === sliceCount` is what says that turn is where a
    // stall would be.
    sliceCount: decision.slices.length,
    reportedSliceCount: decision.reportedSlices,
    lastActivityAt: decision.lastActivityAt,
    resumeAttempts: decision.resumeAttempts,
    maxResumeAttempts: decision.maxResumeAttempts,
  }
}

/** The curation a decision-list answer carries, or null when it carries no review. */
export function curationOf(list: PublicDecisionList): AiReviewCuration | null {
  const decision = prReviewDecisionOf(list)
  return decision === null ? null : toCuration(decision)
}
