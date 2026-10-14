import type {
  Hotspot,
  MilestoneStats,
  PersonReport,
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

export type PeopleOrder = 'reviewed' | 'authored' | 'wait'

export const PEOPLE_ORDERS: { label: string; value: PeopleOrder }[] = [
  { label: 'Most reviews', value: 'reviewed' },
  { label: 'Most pull requests opened', value: 'authored' },
  { label: 'Longest wait for a review', value: 'wait' },
]

/** The name a person goes by: their directory name, else their handle. */
export function personName(person: Pick<PersonReport, 'displayName' | 'login'>): string {
  return person.displayName ?? person.login
}

/**
 * People in the chosen order, narrowed to the ones whose name or handle holds
 * `query`. Ordered by wait, somebody whose pull requests were never reviewed
 * sorts after everybody with a median.
 */
export function orderPeople(
  people: readonly PersonReport[],
  order: PeopleOrder,
  query = '',
): PersonReport[] {
  const needle = query.trim().toLowerCase()
  const matching = people.filter(
    (person) =>
      needle.length === 0 ||
      person.login.toLowerCase().includes(needle) ||
      (person.displayName?.toLowerCase().includes(needle) ?? false),
  )
  return matching.sort((a, b) => compareBy(order, a, b) || a.login.localeCompare(b.login))
}

function compareBy(order: PeopleOrder, a: PersonReport, b: PersonReport): number {
  if (order === 'reviewed') return b.reviewed - a.reviewed
  if (order === 'authored') return b.authored - a.authored
  const waitOf = (person: PersonReport) =>
    person.authoredMetrics.first_human_review.medianMs ?? Number.NEGATIVE_INFINITY
  return waitOf(b) - waitOf(a)
}
