import type { PullRequestRef } from '@sainte-beuve/contracts'
import {
  assessPullRequestContract,
  lookUpPullRequestAssessmentsContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// Pull requests scored by cat-factory's assessor: one on request, and a list's worth read back.
export function assessmentCalls(call: ContractCaller) {
  return {
    assessPullRequest: (pullRequest: PullRequestRef) =>
      call(assessPullRequestContract, { body: { pullRequest } }),
    lookUpPullRequestAssessments: (pullRequests: PullRequestRef[]) =>
      call(lookUpPullRequestAssessmentsContract, { body: { pullRequests } }),
  }
}
