import type { AiReviewCuration, AiReviewResolution } from '@sainte-beuve/contracts'
import type { AiReviewGateway, AiReviewReport } from '@sainte-beuve/kernel'
import { UpstreamFailedError } from '@sainte-beuve/kernel'

// The cat-factory test doubles: a parked review, one finding, and a gateway a
// case drives through the loop. Their own module rather than more of `helpers.ts`
// because they are read together and used by three suites, and the harness file
// is about wiring an app rather than about this one integration.

/** One parked review, with only the fields a case cares about spelled out. */
export function curation(overrides: Partial<AiReviewCuration> = {}): AiReviewCuration {
  return {
    status: 'awaiting_selection',
    findings: [],
    selectedFindingIds: [],
    postedFindingIds: [],
    postedBody: false,
    postAttempts: 0,
    postReport: null,
    sliceCount: 1,
    reportedSliceCount: 1,
    lastActivityAt: null,
    resumeAttempts: 0,
    maxResumeAttempts: 3,
    ...overrides,
  }
}

/** One finding, with only the fields a case cares about spelled out. */
export function aiFinding(
  overrides: Partial<AiReviewCuration['findings'][number]> = {},
): AiReviewCuration['findings'][number] {
  return {
    findingId: 'f-1',
    title: 'Unbounded retry',
    detail: 'The loop never gives up.',
    path: 'src/poll.ts',
    line: 42,
    side: 'RIGHT',
    severity: 'blocker',
    category: 'correctness',
    suggestedFix: null,
    ...overrides,
  }
}

/**
 * A cat-factory gateway a case DRIVES: it records every verb, and `report` is what
 * the next poll will find, so a case moves a review through the loop by assigning
 * to it rather than by scripting a sequence of responses.
 */
export interface StubAiReview extends AiReviewGateway {
  requested: { title: string; instructions: string | null }[]
  dismissed: { runId: string; findingId: string }[]
  resolved: { runId: string; action: AiReviewResolution; findingIds: string[] }[]
  resumed: string[]
  /** How many times it has been polled, so a case can assert a read asked nothing. */
  polls: number
  /** What the next `getStatus` answers. Reassign it to advance the review. */
  report: AiReviewReport
  /** Make the next poll fail, the way an unreachable instance does. */
  pollFails: boolean
}

export function stubAiReview(report: Partial<AiReviewReport> = {}): StubAiReview {
  const stub: StubAiReview = {
    requested: [],
    dismissed: [],
    resolved: [],
    resumed: [],
    polls: 0,
    pollFails: false,
    report: {
      status: 'running',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: null,
      ...report,
    },
    requestReview: async (input) => {
      stub.requested.push({ title: input.title, instructions: input.instructions })
      return { taskId: 'cf-task-1', url: 'https://cat-factory.example.com/tasks/cf-task-1' }
    },
    getStatus: async () => {
      stub.polls += 1
      if (stub.pollFails) throw new UpstreamFailedError('cat-factory could not be reached')
      return stub.report
    },
    dismissFinding: async (input) => {
      stub.dismissed.push(input)
      // Answered the way cat-factory answers it: synchronously, with the decision
      // the drop left behind. A case can then assert what the verb's own answer
      // wrote, with no poll in between.
      const state = stub.report.curation
      if (state === null) return null
      return {
        ...state,
        findings: state.findings.filter((finding) => finding.findingId !== input.findingId),
      }
    },
    resolveReview: async (input) => {
      stub.resolved.push(input)
    },
    resumeReview: async (input) => {
      stub.resumed.push(input.runId)
    },
  }
  return stub
}
