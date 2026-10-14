import type { Project, ReviewMetrics, ReviewMilestone } from '@sainte-beuve/contracts'
import { REVIEW_MILESTONES } from '@sainte-beuve/contracts'
import type { PullRequestTimeline } from '@sainte-beuve/kernel'
import type { MilestoneOutcomes } from './milestones.js'
import { summarize } from './stats.js'

export type ReportedProject = Pick<Project, 'id' | 'provider' | 'owner' | 'repo'>

export interface RepositoryTimelines {
  project: ReportedProject
  pullRequests: readonly PullRequestTimeline[]
}

/** One timed pull request with where it stands on every milestone. */
export interface TimedPullRequest {
  projectId: string
  pullRequest: PullRequestTimeline
  milestones: MilestoneOutcomes
}

export function metricsOf(timed: readonly TimedPullRequest[]): ReviewMetrics {
  const entries = REVIEW_MILESTONES.map((milestone) => [milestone, statsOf(timed, milestone)])
  return Object.fromEntries(entries) as ReviewMetrics
}

function statsOf(timed: readonly TimedPullRequest[], milestone: ReviewMilestone) {
  const durations: number[] = []
  let waiting = 0
  for (const { milestones } of timed) {
    const outcome = milestones[milestone]
    if (outcome.state === 'reached') durations.push(outcome.afterMs)
    else if (outcome.state === 'waiting') waiting += 1
  }
  return summarize(durations, waiting)
}
