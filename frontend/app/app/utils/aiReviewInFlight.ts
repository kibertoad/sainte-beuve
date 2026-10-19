import type { AiReviewInFlight } from '@sainte-beuve/contracts'
import { aiReviewPath } from '@sainte-beuve/contracts'
import { aiReviewStatusLabel } from './aiReviewStatus'

/** How long a row trusts what it was told about the runs in flight before asking again. */
export const IN_FLIGHT_FRESH_MS = 30_000

export interface ProgressLink {
  key: string
  label: string
  /** Where the run is followed: the review screen, focused on the run. */
  to: string
  title: string
}

/** One button per run in flight, each opening the review screen on its run. */
export function progressLinks(runs: readonly AiReviewInFlight[]): ProgressLink[] {
  return runs.map((run, index) => ({
    key: run.runId,
    label:
      runs.length === 1 ? 'AI review progress' : `AI review progress (${index + 1}/${runs.length})`,
    to: aiReviewPath(run.reviewId, run.runId),
    title: `The AI review is ${aiReviewStatusLabel[run.status]}`,
  }))
}
