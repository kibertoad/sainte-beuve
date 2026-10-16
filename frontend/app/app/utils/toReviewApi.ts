import type { ToReviewQuery } from '@sainte-beuve/contracts'
import { listPullRequestsToReviewContract } from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// PRs to review: the open pull requests the viewer is best placed to review next.
export function toReviewCalls(call: ContractCaller) {
  return {
    listPullRequestsToReview: (query: ToReviewQuery) =>
      call(listPullRequestsToReviewContract, { queryParams: query }),
  }
}
