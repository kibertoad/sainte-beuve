import type { PullRequestAssessment } from '@sainte-beuve/contracts'
import type { PullRequestAddress } from './vcs.js'

/** One assessment per pull request, replaced when it is assessed again. */
export interface PullRequestAssessmentRepository {
  get(pullRequest: PullRequestAddress): Promise<PullRequestAssessment | null>
  /** The assessments of those of these pull requests that have one, in no set order. */
  listByPullRequests(pullRequests: readonly PullRequestAddress[]): Promise<PullRequestAssessment[]>
  put(assessment: PullRequestAssessment): Promise<void>
}
