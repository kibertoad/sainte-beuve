import type {
  Hotspot,
  MilestoneStats,
  RepositoryReport,
  ReviewMilestone,
} from '@sainte-beuve/contracts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const MILESTONE_LABELS: Record<ReviewMilestone, string> = {
  first_review: 'First review',
  first_human_review: 'First human review',
  approval: 'Approval',
  merge: 'Merge',
}

export const MILESTONE_DESCRIPTIONS: Record<ReviewMilestone, string> = {
  first_review: 'Any review by somebody other than the author, bots included.',
  first_human_review: 'The same, with bots and AI reviewers such as CodeRabbit left out.',
  approval: 'The first approval by somebody other than the author.',
  merge: 'Merged.',
}

/** A duration short enough to fit a table cell: `45m`, `5.5h`, `3.2d`. Null reads as `n/a`. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return 'n/a'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`
  if (ms < DAY) return `${trimmed(ms / HOUR)}h`
  return `${trimmed(ms / DAY)}d`
}

/** One decimal below ten, none above, and never a trailing `.0`. */
function trimmed(value: number): string {
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return String(rounded)
}

/** How many reached the milestone and how many are still waiting on it. */
export function sampleLabel(stats: MilestoneStats): string {
  const reached = `${stats.reached} reached`
  return stats.waiting === 0 ? reached : `${reached}, ${stats.waiting} waiting`
}

export function repositoryName(repository: Pick<RepositoryReport, 'owner' | 'repo'>): string {
  return `${repository.owner}/${repository.repo}`
}

/** What a hotspot is, in a sentence a lead can act on. */
export function hotspotSummary(hotspot: Hotspot): string {
  const milestone = MILESTONE_LABELS[hotspot.milestone].toLowerCase()
  if (hotspot.reason === 'stalled') {
    const count =
      hotspot.overdue === 1 ? '1 open pull request' : `${hotspot.overdue} open pull requests`
    return `${count} waiting on ${milestone} longer than nearly anything else took`
  }
  return `Median ${milestone} ${formatDuration(hotspot.medianMs)}, against ${formatDuration(hotspot.overallMedianMs)} across the report`
}
