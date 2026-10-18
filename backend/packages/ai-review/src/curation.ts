import type {
  PublicDecisionList,
  PublicPrReviewDecision,
  PublicPrReviewDecisionFindingChallenge,
} from '@cat-factory/sdk'
import type {
  AiReviewCuration,
  AiReviewFinding,
  AiReviewFindingChallenge,
  AiReviewPostReport,
  AiReviewProgress,
} from '@sainte-beuve/contracts'

/**
 * cat-factory's parked `pr-review` decision, projected onto the AI-review port.
 *
 * A projection rather than a re-export of the SDK's own type, for the reason the
 * contracts package exists: the SPA renders these fields, and passing an upstream
 * model straight through would put a cat-factory version bump on the wire between
 * two halves of sainte-beuve.
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
    challenge: challengeOf(finding.challenge),
    sliceId: finding.sliceId,
  }))
}

function challengeOf(
  challenge: PublicPrReviewDecisionFindingChallenge | null,
): AiReviewFindingChallenge | null {
  if (challenge === null) return null
  return {
    status: challenge.status,
    question: challenge.question,
    justification: challenge.justification,
  }
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

/**
 * The findings queued for the fixer behind a post, and whether the instance
 * queues them at all. Read loosely because the published SDK predates the
 * field (kibertoad/cat-factory, `fixFindingIds` on the pr-review decision): an
 * instance that serves it always serves it, so its absence is the answer.
 */
function fixQueueOf(decision: PublicPrReviewDecision): {
  fixFindingIds: string[]
  combinesPostAndFix: boolean
} {
  const queued: unknown = (decision as { fixFindingIds?: unknown }).fixFindingIds
  if (!Array.isArray(queued)) return { fixFindingIds: [], combinesPostAndFix: false }
  return {
    fixFindingIds: queued.filter((id): id is string => typeof id === 'string'),
    combinesPostAndFix: true,
  }
}

/**
 * How many slices the reviewer cut the diff into. cat-factory records the
 * slicing only when the review parks, so while it is still reviewing the count
 * is the reviewer's own to-do list, one entry per slice.
 */
function sliceCountOf(decision: PublicPrReviewDecision, progress: AiReviewProgress | null): number {
  if (decision.slices.length > 0) return decision.slices.length
  if (decision.status !== 'reviewing') return 0
  return progress?.subtasks?.total ?? 0
}

function toCuration(
  decision: PublicPrReviewDecision,
  progress: AiReviewProgress | null,
): AiReviewCuration {
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
    sliceCount: sliceCountOf(decision, progress),
    reportedSliceCount: decision.reportedSlices,
    lastActivityAt: decision.lastActivityAt,
    resumeAttempts: decision.resumeAttempts,
    maxResumeAttempts: decision.maxResumeAttempts,
    summary: decision.summary,
    slices: decision.slices.map((slice) => ({
      sliceId: slice.sliceId,
      title: slice.title,
      rationale: slice.rationale,
      paths: [...slice.paths],
    })),
    ...fixQueueOf(decision),
  }
}

/** The curation a decision-list answer carries, or null when it carries no review. */
export function curationOf(
  list: PublicDecisionList,
  progress: AiReviewProgress | null = null,
): AiReviewCuration | null {
  const decision = prReviewDecisionOf(list)
  return decision === null ? null : toCuration(decision, progress)
}
