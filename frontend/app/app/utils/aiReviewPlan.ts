import type {
  AiReviewCuration,
  AiReviewFinding,
  AiReviewRun,
  ResolveAiReviewInput,
} from '@sainte-beuve/contracts'

// What a curator decides about each finding of a parked AI review, and what
// that adds up to when they apply it. Pure, so the screen and its tests read
// the same rules.

/** What happens to one finding: a comment on the pull request, a fix by cat-factory, or nothing. */
export type FindingChoice = 'comment' | 'fix' | 'ignore'

export type FindingChoices = Record<string, FindingChoice>

export function isRetracted(finding: AiReviewFinding): boolean {
  return finding.challenge?.status === 'retracted'
}

/**
 * The choice a finding starts on. The blockers and the highs are worth saying
 * out loud and the rest are not, which is the obvious call more often than
 * either extreme: nothing chosen makes somebody click eight times, and
 * everything chosen makes Apply the button that publishes the nits too.
 */
function defaultChoice(finding: AiReviewFinding): FindingChoice {
  if (isRetracted(finding)) return 'ignore'
  return finding.severity === 'blocker' || finding.severity === 'high' ? 'comment' : 'ignore'
}

/**
 * The choices a parked review opens on. What cat-factory recorded wins over the
 * defaults, so two people looking at a review that re-parked after a post see
 * the same thing.
 */
export function initialChoices(curation: AiReviewCuration): FindingChoices {
  const recorded = curation.selectedFindingIds.length > 0 || curation.fixFindingIds.length > 0
  const commented = new Set(curation.selectedFindingIds)
  const fixed = new Set(curation.fixFindingIds)
  const choices: FindingChoices = {}
  for (const finding of curation.findings) {
    if (!recorded || isRetracted(finding)) choices[finding.findingId] = defaultChoice(finding)
    else if (fixed.has(finding.findingId)) choices[finding.findingId] = 'fix'
    else choices[finding.findingId] = commented.has(finding.findingId) ? 'comment' : 'ignore'
  }
  return choices
}

/** The choices for the findings there are now: arrivals start on their default, retractions on ignore. */
export function reconcileChoices(
  findings: readonly AiReviewFinding[],
  held: FindingChoices,
): FindingChoices {
  const choices: FindingChoices = {}
  for (const finding of findings) {
    const kept = held[finding.findingId]
    choices[finding.findingId] =
      isRetracted(finding) || kept === undefined ? defaultChoice(finding) : kept
  }
  return choices
}

export interface ResolutionPlan {
  comment: string[]
  fix: string[]
  ignore: string[]
  /** What Apply sends, or null when it cannot be sent. */
  resolution: ResolveAiReviewInput | null
  /** Why it cannot, in a sentence for the screen. */
  blocked: string | null
}

const SPLIT_UNSUPPORTED =
  'This cat-factory cannot post comments and fix findings in one pass. Choose comments or fixes, or upgrade cat-factory.'

/** What the choices add up to. Comments go up before the fixer runs, because they anchor on the reviewed commit. */
export function planOf(curation: AiReviewCuration, choices: FindingChoices): ResolutionPlan {
  const comment: string[] = []
  const fix: string[] = []
  const ignore: string[] = []
  for (const finding of curation.findings) {
    const choice = isRetracted(finding) ? 'ignore' : (choices[finding.findingId] ?? 'ignore')
    if (choice === 'comment') comment.push(finding.findingId)
    else if (choice === 'fix') fix.push(finding.findingId)
    else ignore.push(finding.findingId)
  }
  const base = { comment, fix, ignore }
  if (comment.length > 0 && fix.length > 0) {
    if (!curation.combinesPostAndFix)
      return { ...base, resolution: null, blocked: SPLIT_UNSUPPORTED }
    return {
      ...base,
      resolution: { action: 'post', findingIds: comment, fixFindingIds: fix },
      blocked: null,
    }
  }
  if (comment.length > 0) {
    return { ...base, resolution: { action: 'post', findingIds: comment }, blocked: null }
  }
  if (fix.length > 0)
    return { ...base, resolution: { action: 'fix', findingIds: fix }, blocked: null }
  return { ...base, resolution: { action: 'finish', findingIds: [] }, blocked: null }
}

/** The label on the Apply button, which says what it is about to do. */
export function applyLabel(plan: ResolutionPlan): string {
  const parts: string[] = []
  if (plan.comment.length > 0) parts.push(`post ${count(plan.comment.length, 'comment')}`)
  if (plan.fix.length > 0) parts.push(`fix ${count(plan.fix.length, 'finding')}`)
  if (parts.length === 0) return 'Close without posting'
  const sentence = parts.join(', then ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
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
  { key: 'acting', label: 'Posting and fixing' },
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
  if (tasks === null || tasks === undefined || tasks.total === 0) {
    return 'The fixer is committing onto the branch.'
  }
  return `The fixer is committing onto the branch: ${tasks.completed} of ${tasks.total} steps done.`
}

/** 0 to 1 for a progress bar, or null when there is nothing honest to show. */
export function progressFraction(run: AiReviewRun): number | null {
  if (run.status !== 'running') return null
  const curation = run.curation
  if ((curation === null || curation.status === 'reviewing') && curation?.sliceCount) {
    return Math.min(1, curation.reportedSliceCount / curation.sliceCount)
  }
  const fraction = run.progress?.fraction
  return fraction === undefined || fraction <= 0 ? null : Math.min(1, fraction)
}
