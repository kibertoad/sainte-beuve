import {
  type Hotspot,
  REVIEW_MILESTONES,
  type ReviewMetrics,
  type ReviewMilestone,
} from '@sainte-beuve/contracts'
import { metricsOf, type ReportedProject, type TimedPullRequest } from './metrics.js'

/** Fewer pull requests than this reaching a milestone is too few for a median to accuse anybody. */
export const MIN_HOTSPOT_SAMPLE = 3

/** A median this many times the whole report's is slow. */
export const SLOW_FACTOR = 1.5

/** This many open pull requests past the report's p90 make a repository stalled. */
export const STALLED_OVERDUE = 2

/** What counts as overdue when nothing in the report reached the milestone to take a p90 from. */
const FALLBACK_OVERDUE_MS = 24 * 60 * 60 * 1000

interface RepositoryTimed {
  project: ReportedProject
  timed: readonly TimedPullRequest[]
}

interface Ranked {
  hotspot: Hotspot
  /** How far past the report's norm it is, in ms, for the order. */
  excessMs: number
}

/**
 * The repositories that stand out from the rest of the report on a milestone,
 * worst first. One per repository and milestone: a repository both slow and
 * stalled is reported stalled, which is the one somebody can act on today.
 */
export function findHotspots(
  repositories: readonly RepositoryTimed[],
  overall: ReviewMetrics,
): Hotspot[] {
  const ranked: Ranked[] = []
  for (const { project, timed } of repositories) {
    const metrics = metricsOf(timed)
    for (const milestone of REVIEW_MILESTONES) {
      const found = hotspotOf({ projectId: project.id, timed, milestone }, metrics, overall)
      if (found !== null) ranked.push(found)
    }
  }
  return ranked.sort((a, b) => b.excessMs - a.excessMs).map((entry) => entry.hotspot)
}

function hotspotOf(
  subject: { projectId: string; timed: readonly TimedPullRequest[]; milestone: ReviewMilestone },
  metrics: ReviewMetrics,
  overall: ReviewMetrics,
): Ranked | null {
  const { projectId, timed, milestone } = subject
  const own = metrics[milestone]
  const norm = overall[milestone]
  const threshold = norm.p90Ms ?? FALLBACK_OVERDUE_MS
  const overdueWaits = overdueWaitsOf(timed, milestone, threshold)
  const base = {
    projectId,
    milestone,
    medianMs: own.medianMs,
    overallMedianMs: norm.medianMs,
    overdue: overdueWaits.length,
  }
  if (overdueWaits.length >= STALLED_OVERDUE) {
    return {
      hotspot: { ...base, reason: 'stalled' },
      excessMs: Math.max(...overdueWaits) - threshold,
    }
  }
  if (isSlow(own.reached, own.medianMs, norm.medianMs)) {
    return { hotspot: { ...base, reason: 'slow' }, excessMs: own.medianMs - (norm.medianMs ?? 0) }
  }
  return null
}

function isSlow(
  reached: number,
  median: number | null,
  overallMedian: number | null,
): median is number {
  if (reached < MIN_HOTSPOT_SAMPLE || median === null || overallMedian === null) return false
  return overallMedian > 0 ? median >= overallMedian * SLOW_FACTOR : median > 0
}

function overdueWaitsOf(
  timed: readonly TimedPullRequest[],
  milestone: ReviewMilestone,
  threshold: number,
): number[] {
  return timed.flatMap(({ milestones }) => {
    const outcome = milestones[milestone]
    return outcome.state === 'waiting' && outcome.forMs > threshold ? [outcome.forMs] : []
  })
}
