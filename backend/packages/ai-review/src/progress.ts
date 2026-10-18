import type { PublicRun } from '@cat-factory/sdk'
import type { AiReviewProgress } from '@sainte-beuve/contracts'

/**
 * The step a run is on, as the review screen shows its progress. Null when the
 * run names a step it does not carry, which a run being rebuilt can do for one
 * read.
 */
export function progressOf(run: PublicRun): AiReviewProgress | null {
  const step = run.steps[run.currentStep]
  if (step === undefined) return null
  return {
    agentKind: step.agentKind,
    state: step.state,
    fraction: step.progress,
    subtasks:
      step.subtasks === null
        ? null
        : {
            completed: step.subtasks.completed,
            inProgress: step.subtasks.inProgress,
            total: step.subtasks.total,
          },
  }
}
