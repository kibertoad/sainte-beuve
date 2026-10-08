import type {
  MergeMyPullRequestInput,
  MyPullRequestsQuery,
  PostMergeComment,
} from '@sainte-beuve/contracts'
import {
  listMyPullRequestsContract,
  mergeMyPullRequestContract,
  postMergeCommentContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// My PRs: the viewer's own open pull requests, and merging them.
export function myPullRequestCalls(call: ContractCaller) {
  return {
    listMyPullRequests: (query: MyPullRequestsQuery) =>
      call(listMyPullRequestsContract, { queryParams: query }),
    mergeMyPullRequest: (input: MergeMyPullRequestInput) =>
      call(mergeMyPullRequestContract, { body: input }),
    postMergeComment: (input: PostMergeComment) => call(postMergeCommentContract, { body: input }),
  }
}
