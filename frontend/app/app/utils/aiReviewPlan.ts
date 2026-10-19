import type {
  AiReviewCuration,
  AiReviewFinding,
  AiReviewRun,
  ResolveAiReviewInput,
} from '@sainte-beuve/contracts'

// How a curator settles a parked AI review, and what that adds up to when they
// apply it. Pure, so the screen and its tests read the same rules.

/**
 * How a review settles, for every finding it acts on: comments for the author
 * to address, or fixes cat-factory commits itself. One or the other, because
 * handing some findings to each leaves the author fixing on a branch the fixer
 * is committing to.
 */
export type ReviewOutcome = 'comment' | 'fix'

/** Whether each finding is acted on, by finding id. */
export type FindingPicks = Record<string, boolean>

export interface ReviewDraft {
  outcome: ReviewOutcome
  picks: FindingPicks
}

export function isRetracted(finding: AiReviewFinding): boolean {
  return finding.challenge?.status === 'retracted'
}

/**
 * Whether a finding starts picked. The blockers and the highs are worth acting
 * on and the rest are not, which is the obvious call more often than either
 * extreme: nothing picked makes somebody click eight times, and everything
 * picked makes Apply the button that acts on the nits too.
 */
function pickedByDefault(finding: AiReviewFinding): boolean {
  if (isRetracted(finding)) return false
  return finding.severity === 'blocker' || finding.severity === 'high'
}

/**
 * The draft a parked review opens on. What cat-factory recorded wins over the
 * defaults, so two people looking at a review that re-parked after a post see
 * the same thing. A re-park only follows a post, so it opens on comments.
 */
export function initialDraft(curation: AiReviewCuration): ReviewDraft {
  const recorded = new Set(curation.selectedFindingIds)
  const picks: FindingPicks = {}
  for (const finding of curation.findings) {
    picks[finding.findingId] =
      recorded.size === 0 || isRetracted(finding)
        ? pickedByDefault(finding)
        : recorded.has(finding.findingId)
  }
  return { outcome: 'comment', picks }
}

/** The draft for the findings there are now: arrivals start on their default, retractions unpicked. */
export function reconcileDraft(
  findings: readonly AiReviewFinding[],
  held: ReviewDraft,
): ReviewDraft {
  const picks: FindingPicks = {}
  for (const finding of findings) {
    const kept = held.picks[finding.findingId]
    picks[finding.findingId] =
      isRetracted(finding) || kept === undefined ? pickedByDefault(finding) : kept
  }
  return { outcome: held.outcome, picks }
}

export interface ResolutionPlan {
  outcome: ReviewOutcome
  picked: string[]
  left: string[]
  /** What Apply sends. */
  resolution: ResolveAiReviewInput
}

/** What the draft adds up to. Nothing picked closes the review having said nothing. */
export function planOf(curation: AiReviewCuration, draft: ReviewDraft): ResolutionPlan {
  const picked: string[] = []
  const left: string[] = []
  for (const finding of curation.findings) {
    const on = !isRetracted(finding) && draft.picks[finding.findingId] === true
    ;(on ? picked : left).push(finding.findingId)
  }
  const resolution: ResolveAiReviewInput =
    picked.length === 0
      ? { action: 'finish', findingIds: [] }
      : { action: draft.outcome === 'comment' ? 'post' : 'fix', findingIds: picked }
  return { outcome: draft.outcome, picked, left, resolution }
}

/** The label on the Apply button, which says what it is about to do. */
export function applyLabel(plan: ResolutionPlan): string {
  const n = plan.picked.length
  if (n === 0) return 'Close without posting'
  return plan.outcome === 'comment' ? `Post ${count(n, 'comment')}` : `Fix ${count(n, 'finding')}`
}

/**
 * What a finding's checkbox says under each outcome: checked acts on it, as a
 * comment posted or a fix committed, and unchecked says it is left alone.
 */
export const pickChoice: Record<ReviewOutcome, { on: string; off: string }> = {
  comment: { on: 'Post', off: 'Skipped' },
  fix: { on: 'Fix', off: 'Ignored' },
}

/** The footer's tally, in the words the checkboxes use. */
export function planTally(plan: ResolutionPlan): string {
  return plan.outcome === 'comment'
    ? `${plan.picked.length} to post · ${plan.left.length} skipped`
    : `${plan.picked.length} to fix · ${plan.left.length} ignored`
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export type JourneyStepState = 'done' | 'current' | 'upcoming' | 'failed'

export interface JourneyStep {
  key: 'filed' | 'reviewing' | 'deciding' | 'acting' | 'done'
  label: string
  state: JourneyStepState
}

const STEPS: readonly Pick<JourneyStep, 'key' | 'label'>[] = [
  { key: 'filed', label: 'Filed' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'deciding', label: 'Your call' },
  { key: 'acting', label: 'Posting or fixing' },
  { key: 'done', label: 'Done' },
]

/** Which step of the journey a run is on, read off its status and its review's. */
function currentStepOf(run: AiReviewRun): JourneyStep['key'] {
  if (run.status === 'completed') return 'done'
  if (run.status === 'requested') return 'filed'
  const phase = run.curation?.status
  if (phase === 'posting' || phase === 'fixing' || phase === 'done') return 'acting'
  if (phase === 'awaiting_selection' || phase === 'challenging') return 'deciding'
  if (run.status === 'awaiting_selection') return 'deciding'
  return run.catFactoryTaskId === null ? 'filed' : 'reviewing'
}

export function journeyOf(run: AiReviewRun): JourneyStep[] {
  const current = currentStepOf(run)
  const at = STEPS.findIndex((step) => step.key === current)
  const stopped = run.status === 'failed' || run.status === 'cancelled'
  return STEPS.map((step, index) => {
    if (run.status === 'completed') return { ...step, state: 'done' }
    if (index < at) return { ...step, state: 'done' }
    if (index > at) return { ...step, state: 'upcoming' }
    return { ...step, state: stopped ? 'failed' : 'current' }
  })
}

/** One line on what cat-factory is doing right now, or null when nothing is moving. */
export function activityLine(run: AiReviewRun): string | null {
  const curation = run.curation
  if (run.status === 'requested') return 'Handing the pull request to cat-factory.'
  if (run.status !== 'running') return null
  switch (curation?.status) {
    case 'challenging':
      return 'An investigator is re-reading the source behind a challenged finding.'
    case 'posting':
      return 'Posting the comments on the pull request.'
    case 'fixing':
      return fixingLine(run)
    case 'done':
    case 'skipped':
      return 'Wrapping up the run.'
    default:
      return reviewingLine(run)
  }
}

function reviewingLine(run: AiReviewRun): string {
  const curation = run.curation
  if (curation === null || curation.sliceCount === 0) return 'Reading the change and slicing it.'
  if (curation.reportedSliceCount >= curation.sliceCount) {
    return `All ${curation.sliceCount} slices are in. Putting the findings together.`
  }
  return `${curation.reportedSliceCount} of ${curation.sliceCount} slices reviewed.`
}

function fixingLine(run: AiReviewRun): string {
  const tasks = run.progress?.subtasks
  if (!tasks || tasks.total === 0) {
    return 'The fixer is committing onto the branch.'
  }
  return `The fixer is committing onto the branch: ${tasks.completed} of ${tasks.total} steps done.`
}

/** 0 to 1 for a progress bar, or null when there is nothing honest to show. */
export function progressFraction(run: AiReviewRun): number | null {
  if (run.status !== 'running') return null
  const curation = run.curation
  if (curation?.status === 'reviewing' && curation.sliceCount > 0) {
    return Math.min(1, curation.reportedSliceCount / curation.sliceCount)
  }
  const fraction = run.progress?.fraction
  return fraction === undefined || fraction <= 0 ? null : Math.min(1, fraction)
}
