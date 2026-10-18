import type { AiReviewCuration, PullRequestRef, ResolveAiReview } from '@sainte-beuve/contracts'
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
    summary: null,
    slices: [],
    fixFindingIds: [],
    combinesPostAndFix: false,
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
    sliceId: null,
    challenge: null,
    ...overrides,
  }
}

/**
 * A cat-factory gateway a case DRIVES: it records every verb, and `report` is what
 * the next poll will find, so a case moves a review through the loop by assigning
 * to it rather than by scripting a sequence of responses.
 */
export interface StubAiReview extends AiReviewGateway {
  requested: {
    title: string
    instructions: string | null
    directoryKeys: readonly string[]
    ownerDirectoryKeys?: readonly string[]
  }[]
  /** The pull requests handed to the conflict resolver, in order. */
  conflictsResolved: { pullRequest: PullRequestRef; directoryKeys: readonly string[] }[]
  dismissed: { runId: string; findingId: string }[]
  resolved: ({ runId: string } & ResolveAiReview)[]
  resumed: string[]
  challenged: { runId: string; findingId: string; question: string | null }[]
  /** The workspace filing answers with. Null is the key's only workspace. */
  filedIn: string | null
  /** The workspace every poll and curation verb named, in order. */
  workspaces: (string | null)[]
  /** How many times it has been polled, so a case can assert a read asked nothing. */
  polls: number
  /** The cat-factory task id of every poll, in order. What a rotation is asserted on. */
  polled: string[]
  /**
   * Run before each poll answers, so a case can make the store move UNDER a poll
   * that is already in flight. That race is the one the clock made ordinary: it
   * polls a whole tenancy sequentially while reads and curation verbs write the
   * same rows.
   */
  onPoll: ((taskId: string) => Promise<void>) | null
  /** What the next `getStatus` answers. Reassign it to advance the review. */
  report: AiReviewReport
  /** Make the next poll fail, the way an unreachable instance does. */
  pollFails: boolean
}

/**
 * A dismissal answered the way cat-factory answers it: synchronously, with the
 * decision the drop left behind. A case can then assert what the verb's own
 * answer wrote, with no poll in between.
 */
function afterDismissal(
  state: AiReviewCuration | null,
  findingId: string,
): AiReviewCuration | null {
  if (state === null) return null
  return { ...state, findings: state.findings.filter((finding) => finding.findingId !== findingId) }
}

export function stubAiReview(report: Partial<AiReviewReport> = {}): StubAiReview {
  const stub: StubAiReview = {
    requested: [],
    conflictsResolved: [],
    dismissed: [],
    resolved: [],
    resumed: [],
    challenged: [],
    filedIn: null,
    workspaces: [],
    polls: 0,
    polled: [],
    onPoll: null,
    pollFails: false,
    report: {
      status: 'running',
      runId: 'cf-run-1',
      summary: null,
      failureReason: null,
      curation: null,
      progress: null,
      ...report,
    },
    requestReview: async (input) => {
      const { title, instructions, directoryKeys, ownerDirectoryKeys } = input
      stub.requested.push({ title, instructions, directoryKeys, ownerDirectoryKeys })
      // Numbered, not fixed: a case about the clock's rotation files several
      // reviews and asserts WHICH of them a given tick polled.
      const taskId = `cf-task-${stub.requested.length}`
      return {
        taskId,
        url: `https://cat-factory.example.com/tasks/${taskId}`,
        workspaceId: stub.filedIn,
      }
    },
    requestConflictResolution: async ({ pullRequest, directoryKeys }) => {
      stub.conflictsResolved.push({ pullRequest, directoryKeys })
      const taskId = `cf-conflicts-${stub.conflictsResolved.length}`
      return {
        taskId,
        url: `https://cat-factory.example.com/tasks/${taskId}`,
        workspaceId: stub.filedIn,
      }
    },
    getStatus: async ({ taskId, workspaceId }) => {
      stub.workspaces.push(workspaceId)
      stub.polls += 1
      stub.polled.push(taskId)
      await stub.onPoll?.(taskId)
      if (stub.pollFails) throw new UpstreamFailedError('cat-factory could not be reached')
      return stub.report
    },
    ...curationVerbs(() => stub),
  }
  return stub
}

/** The curation half of the stub, recording each verb and the workspace it named. */
function curationVerbs(
  stubOf: () => StubAiReview,
): Pick<AiReviewGateway, 'dismissFinding' | 'resolveReview' | 'resumeReview' | 'challengeFinding'> {
  return {
    dismissFinding: async ({ workspaceId, ...input }) => {
      stubOf().workspaces.push(workspaceId)
      stubOf().dismissed.push(input)
      return afterDismissal(stubOf().report.curation, input.findingId)
    },
    resolveReview: async ({ workspaceId, ...input }) => {
      stubOf().workspaces.push(workspaceId)
      stubOf().resolved.push(input)
    },
    resumeReview: async ({ runId, workspaceId }) => {
      stubOf().workspaces.push(workspaceId)
      stubOf().resumed.push(runId)
    },
    challengeFinding: async ({ workspaceId, ...input }) => {
      stubOf().workspaces.push(workspaceId)
      stubOf().challenged.push(input)
      stubOf().report = challenged(stubOf().report, input)
    },
  }
}

/**
 * What cat-factory reports once it has accepted a challenge: the finding is
 * investigating, and the review is no longer waiting on a person.
 */
function challenged(
  report: AiReviewReport,
  input: { findingId: string; question: string | null },
): AiReviewReport {
  const state = report.curation
  if (state === null) return report
  return {
    ...report,
    status: 'running',
    curation: {
      ...state,
      status: 'challenging',
      findings: state.findings.map((finding) =>
        finding.findingId === input.findingId
          ? {
              ...finding,
              challenge: { status: 'investigating', question: input.question, justification: null },
            }
          : finding,
      ),
    },
  }
}
