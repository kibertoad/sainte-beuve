import type {
  MergeMyPullRequestInput,
  MyPullRequestsQuery,
  PostMergeComment,
  ResolveConflicts,
} from '@sainte-beuve/contracts'
import {
  listMyPullRequestsContract,
  mergeMyPullRequestContract,
  postMergeCommentContract,
  resolveConflictsContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// My PRs: the viewer's own open pull requests, merging them, and resolving their conflicts.
export function myPullRequestCalls(call: ContractCaller) {
  return {
    listMyPullRequests: (query: MyPullRequestsQuery) =>
      call(listMyPullRequestsContract, { queryParams: query }),
    mergeMyPullRequest: (input: MergeMyPullRequestInput) =>
      call(mergeMyPullRequestContract, { body: input }),
    postMergeComment: (input: PostMergeComment) => call(postMergeCommentContract, { body: input }),
    resolveConflicts: (input: ResolveConflicts) => call(resolveConflictsContract, { body: input }),
  }
}
