import type { PullRequestAssessment } from '@sainte-beuve/contracts'
import {
  type PullRequestAddress,
  type PullRequestAssessmentRepository,
  pullRequestKey,
} from '@sainte-beuve/kernel'
import { clone } from './clone.js'

/** One org's pull request assessments, keyed by pull request. */
export class InMemoryPullRequestAssessmentRepository implements PullRequestAssessmentRepository {
  private readonly rows = new Map<string, PullRequestAssessment>()

  async get(pullRequest: PullRequestAddress): Promise<PullRequestAssessment | null> {
    const row = this.rows.get(pullRequestKey(pullRequest))
    return row === undefined ? null : clone(row)
  }

  async listByPullRequests(
    pullRequests: readonly PullRequestAddress[],
  ): Promise<PullRequestAssessment[]> {
    return [...new Set(pullRequests.map(pullRequestKey))].flatMap((key) => {
      const row = this.rows.get(key)
      return row === undefined ? [] : [clone(row)]
    })
  }

  async put(assessment: PullRequestAssessment): Promise<void> {
    this.rows.set(pullRequestKey(assessment.pullRequest), clone(assessment))
  }
}
