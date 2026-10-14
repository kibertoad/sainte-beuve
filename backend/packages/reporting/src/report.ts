import {
  MAX_SLOW_PULL_REQUESTS,
  type RepositoryReport,
  type ReviewMetrics,
  type ReviewReport,
  type SlowPullRequest,
} from '@sainte-beuve/contracts'
import type { EpochMs } from '@sainte-beuve/kernel'
import { findHotspots } from './hotspots.js'
import {
  metricsOf,
  type ReportedProject,
  type RepositoryTimelines,
  type TimedPullRequest,
} from './metrics.js'
import { isTimed, milestonesOf } from './milestones.js'

export interface ReviewReportInput {
  repositories: readonly RepositoryTimelines[]
  days: number
  now: EpochMs
  /** The project the report is narrowed to, or null for all of them. */
  projectId: string | null
}

/** The report, short of the per-repository read outcomes the caller adds. */
export type ComputedReviewReport = Omit<ReviewReport, 'sources'>

const DAY_MS = 24 * 60 * 60 * 1000

/** The start of a report's window: pull requests opened from here on are counted. */
export function windowStart(now: EpochMs, days: number): EpochMs {
  return now - days * DAY_MS
}

/**
 * How long the pull requests opened in the last `days` took to reach each
 * milestone, per repository and over all of them, the repositories that stand
 * out, and the longest waits for a human review.
 */
export function buildReviewReport(input: ReviewReportInput): ComputedReviewReport {
  const since = windowStart(input.now, input.days)
  const perRepository = input.repositories.map((repository) => {
    const timed = timedPullRequests(repository, since, input.now)
    return { project: repository.project, timed, metrics: metricsOf(timed) }
  })
  const all = perRepository.flatMap((repository) => repository.timed)
  const metrics = metricsOf(all)
  const repositories = perRepository
    .map(({ project, timed, metrics: own }) => repositoryReport(project, timed.length, own))
    .sort(
      (a, b) =>
        b.pullRequests - a.pullRequests ||
        `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`),
    )
  return {
    days: input.days,
    since,
    generatedAt: input.now,
    projectId: input.projectId,
    pullRequests: all.length,
    metrics,
    repositories,
    hotspots: perRepository.length > 1 ? findHotspots(perRepository, metrics) : [],
    slowest: slowest(all),
  }
}

function timedPullRequests(
  repository: RepositoryTimelines,
  since: EpochMs,
  now: EpochMs,
): TimedPullRequest[] {
  return repository.pullRequests
    .filter((pr) => pr.createdAt >= since && isTimed(pr))
    .map((pr) => ({
      projectId: repository.project.id,
      pullRequest: pr,
      milestones: milestonesOf(pr, now),
    }))
}

function repositoryReport(
  project: ReportedProject,
  pullRequests: number,
  metrics: ReviewMetrics,
): RepositoryReport {
  return {
    projectId: project.id,
    provider: project.provider,
    owner: project.owner,
    repo: project.repo,
    pullRequests,
    metrics,
  }
}

/** The longest waits for a human review, finished or not. */
function slowest(timed: readonly TimedPullRequest[]): SlowPullRequest[] {
  return timed
    .flatMap(({ projectId, pullRequest, milestones }) => {
      const outcome = milestones.first_human_review
      if (outcome.state === 'excluded') return []
      const waiting = outcome.state === 'waiting'
      return [
        {
          projectId,
          number: pullRequest.number,
          title: pullRequest.title,
          url: pullRequest.url,
          authorLogin: pullRequest.authorLogin,
          readyAt: pullRequest.readyAt,
          waitMs: waiting ? outcome.forMs : outcome.afterMs,
          waiting,
        },
      ]
    })
    .sort((a, b) => b.waitMs - a.waitMs)
    .slice(0, MAX_SLOW_PULL_REQUESTS)
}
