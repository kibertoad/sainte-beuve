import type {
  AskSuggestedReviewersInput,
  MergeMyPullRequestInput,
  MyPullRequestsQuery,
  PostMergeComment,
  ResolveConflicts,
  ReviewerSuggestionsQueryInput,
} from '@sainte-beuve/contracts'
import {
  askSuggestedReviewersContract,
  listMyPullRequestsContract,
  mergeMyPullRequestContract,
  postMergeCommentContract,
  resolveConflictsContract,
  suggestReviewersContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// My PRs: the viewer's own open pull requests, merging them, resolving their
// conflicts, and asking reviewers for them.
export function myPullRequestCalls(call: ContractCaller) {
  return {
    listMyPullRequests: (query: MyPullRequestsQuery) =>
      call(listMyPullRequestsContract, { queryParams: query }),
    mergeMyPullRequest: (input: MergeMyPullRequestInput) =>
      call(mergeMyPullRequestContract, { body: input }),
    postMergeComment: (input: PostMergeComment) => call(postMergeCommentContract, { body: input }),
    resolveConflicts: (input: ResolveConflicts) => call(resolveConflictsContract, { body: input }),
    suggestReviewers: (input: ReviewerSuggestionsQueryInput) =>
      call(suggestReviewersContract, { body: input }),
    askSuggestedReviewers: (input: AskSuggestedReviewersInput) =>
      call(askSuggestedReviewersContract, { body: input }),
  }
}
