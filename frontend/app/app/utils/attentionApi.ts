import type {
  CreateAttentionRequestInput,
  PullRequestRef,
  RecommendReviewers,
} from '@sainte-beuve/contracts'
import {
  cancelAttentionContract,
  commitToAttentionContract,
  commitToPullRequestContract,
  listAttentionContract,
  recommendReviewersContract,
  releaseCommitmentContract,
  requestAttentionContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// Asking for attention: who fits best, the ask itself, and the answers to it.
export function attentionCalls(call: ContractCaller) {
  return {
    recommendReviewers: (request: RecommendReviewers) =>
      call(recommendReviewersContract, { body: request }),
    listAttention: () => call(listAttentionContract, {}),
    requestAttention: (request: CreateAttentionRequestInput) =>
      call(requestAttentionContract, { body: request }),
    commitToAttention: (attentionId: string) =>
      call(commitToAttentionContract, { pathParams: { attentionId }, body: {} }),
    cancelAttention: (attentionId: string) =>
      call(cancelAttentionContract, { pathParams: { attentionId } }),
    commitToPullRequest: (pullRequest: PullRequestRef, title: string) =>
      call(commitToPullRequestContract, { body: { pullRequest, title } }),
    releaseCommitment: (commitmentId: string) =>
      call(releaseCommitmentContract, { pathParams: { commitmentId } }),
  }
}
