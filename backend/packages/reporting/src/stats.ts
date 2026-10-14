import type { MilestoneStats } from '@sainte-beuve/contracts'

/**
 * The `fraction` quantile of `sorted` (ascending), interpolated between the two
 * nearest ranks, so the median of an even count is the mean of the middle two.
 */
export function quantile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  const rank = (sorted.length - 1) * fraction
  const below = Math.floor(rank)
  const above = Math.ceil(rank)
  const low = sorted[below] ?? 0
  const high = sorted[above] ?? low
  return Math.round(low + (high - low) * (rank - below))
}

/** The durations of the pull requests that reached a milestone, and how many are still waiting. */
export function summarize(durations: readonly number[], waiting: number): MilestoneStats {
  const sorted = [...durations].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    reached: sorted.length,
    waiting,
    medianMs: quantile(sorted, 0.5),
    p90Ms: quantile(sorted, 0.9),
    meanMs: sorted.length === 0 ? null : Math.round(total / sorted.length),
  }
}
