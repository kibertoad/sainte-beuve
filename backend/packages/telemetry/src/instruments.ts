import type { Attributes, Meter } from '@opentelemetry/api'
import type { MilestoneStats, ReviewMilestone, ReviewReport } from '@sainte-beuve/contracts'
import { REVIEW_MILESTONES } from '@sainte-beuve/contracts'
import type { OrgReviewReport } from '@sainte-beuve/kernel'

/** One gauge per milestone, in seconds, with the statistic as an attribute. */
export const DURATION_METRICS: Record<ReviewMilestone, string> = {
  first_review: 'sainte_beuve.review.time_to_first_review',
  first_human_review: 'sainte_beuve.review.time_to_first_human_review',
  approval: 'sainte_beuve.review.time_to_approval',
  merge: 'sainte_beuve.review.time_to_merge',
}

/** Pull requests per milestone and state: reached it, or still waiting. */
export const PULL_REQUESTS_METRIC = 'sainte_beuve.review.pull_requests'

/** 1 for each repository and milestone the report names a hotspot. */
export const HOTSPOT_METRIC = 'sainte_beuve.review.hotspot'

const STATISTICS = [
  ['p50', 'medianMs'],
  ['p90', 'p90Ms'],
  ['mean', 'meanMs'],
] as const

type Gauge = ReturnType<Meter['createGauge']>

interface Gauges {
  durations: Record<ReviewMilestone, Gauge>
  pullRequests: Gauge
  hotspot: Gauge
}

export function createGauges(meter: Meter): Gauges {
  const durations = Object.fromEntries(
    REVIEW_MILESTONES.map((milestone) => [
      milestone,
      meter.createGauge(DURATION_METRICS[milestone], {
        unit: 's',
        description: `How long pull requests took to reach ${milestone.replaceAll('_', ' ')}, from ready for review`,
      }),
    ]),
  ) as Record<ReviewMilestone, Gauge>
  return {
    durations,
    pullRequests: meter.createGauge(PULL_REQUESTS_METRIC, {
      unit: '{pull_request}',
      description:
        'Pull requests opened in the window that reached a milestone, or are waiting on it',
    }),
    hotspot: meter.createGauge(HOTSPOT_METRIC, {
      description: 'A repository standing out from the rest of its org on a milestone',
    }),
  }
}

/** Record one org's report: the org as a whole, then every repository, then its hotspots. */
export function recordReport(gauges: Gauges, { org, report }: OrgReviewReport): void {
  const base: Attributes = {
    'sainte_beuve.org': org.slug,
    'sainte_beuve.report.window_days': report.days,
  }
  recordMetrics(gauges, report.metrics, { ...base, 'sainte_beuve.report.scope': 'org' })
  const repositories = new Map(report.repositories.map((entry) => [entry.projectId, entry]))
  for (const repository of report.repositories) {
    recordMetrics(gauges, repository.metrics, { ...base, ...repositoryAttributes(repository) })
  }
  for (const hotspot of report.hotspots) {
    const repository = repositories.get(hotspot.projectId)
    if (repository === undefined) continue
    gauges.hotspot.record(1, {
      ...base,
      ...repositoryAttributes(repository),
      'sainte_beuve.review.milestone': hotspot.milestone,
      'sainte_beuve.review.hotspot_reason': hotspot.reason,
    })
  }
}

function repositoryAttributes(repository: ReviewReport['repositories'][number]): Attributes {
  return {
    'sainte_beuve.report.scope': 'repository',
    'vcs.provider.name': repository.provider,
    'vcs.owner.name': repository.owner,
    'vcs.repository.name': repository.repo,
  }
}

function recordMetrics(
  gauges: Gauges,
  metrics: Record<ReviewMilestone, MilestoneStats>,
  attributes: Attributes,
): void {
  for (const milestone of REVIEW_MILESTONES) {
    const stats = metrics[milestone]
    for (const [statistic, field] of STATISTICS) {
      const value = stats[field]
      if (value === null) continue
      gauges.durations[milestone].record(value / 1000, {
        ...attributes,
        'sainte_beuve.statistic': statistic,
      })
    }
    const milestoneAttributes = { ...attributes, 'sainte_beuve.review.milestone': milestone }
    gauges.pullRequests.record(stats.reached, {
      ...milestoneAttributes,
      'sainte_beuve.review.state': 'reached',
    })
    gauges.pullRequests.record(stats.waiting, {
      ...milestoneAttributes,
      'sainte_beuve.review.state': 'waiting',
    })
  }
}
