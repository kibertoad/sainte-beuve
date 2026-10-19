import type { LatestAiReviewRun } from '@sainte-beuve/contracts'
import { aiReviewPath } from '@sainte-beuve/contracts'
import { aiReviewStatusLabel, isInFlight } from './aiReviewStatus'

/** How long a row trusts what it was told about a pull request's latest runs before asking again. */
export const LATEST_RUNS_FRESH_MS = 30_000

export interface RunLink {
  key: string
  label: string
  /** The review screen, focused on the run. */
  to: string
  title: string
}

/** One button per run in flight, each opening the review screen on its run. */
export function progressLinks(runs: readonly LatestAiReviewRun[]): RunLink[] {
  const inFlight = runs.filter(isInFlight)
  return inFlight.map((run, index) => ({
    key: run.runId,
    label:
      inFlight.length === 1
        ? 'AI review progress'
        : `AI review progress (${index + 1}/${inFlight.length})`,
    to: aiReviewPath(run.reviewId, run.runId),
    title: `The AI review is ${aiReviewStatusLabel[run.status]}`,
  }))
}

/** The latest completed run's results, or null when no review of the pull request has completed. */
export function resultsLink(runs: readonly LatestAiReviewRun[]): RunLink | null {
  const latest = runs
    .filter((run) => run.status === 'completed')
    .reduce<LatestAiReviewRun | null>(
      (newest, run) => (newest === null || run.requestedAt > newest.requestedAt ? run : newest),
      null,
    )
  if (latest === null) return null
  return {
    key: latest.runId,
    label: 'AI review results',
    to: aiReviewPath(latest.reviewId, latest.runId),
    title: 'Open the results of the latest completed AI review',
  }
}
