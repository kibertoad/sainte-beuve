import type {
  CreateAttentionRequestInput,
  PullRequestRef,
  RecommendReviewersInput,
} from '@sainte-beuve/contracts'
import {
  askMoreAttentionContract,
  cancelAttentionContract,
  commitToAttentionContract,
  commitToPullRequestContract,
  declineAttentionContract,
  listAttentionContract,
  recommendReviewersContract,
  releaseCommitmentContract,
  requestAttentionContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// Asking for attention: who fits best, the ask itself, and the answers to it.
export function attentionCalls(call: ContractCaller) {
  return {
    recommendReviewers: (request: RecommendReviewersInput) =>
      call(recommendReviewersContract, { body: request }),
    listAttention: () => call(listAttentionContract, {}),
    requestAttention: (request: CreateAttentionRequestInput) =>
      call(requestAttentionContract, { body: request }),
    commitToAttention: (attentionId: string) =>
      call(commitToAttentionContract, { pathParams: { attentionId }, body: {} }),
    declineAttention: (attentionId: string, reason: string | null = null) =>
      call(declineAttentionContract, { pathParams: { attentionId }, body: { reason } }),
    /** No ids asks the next best matches, as many as the ask is short. */
    askMoreAttention: (attentionId: string, recipientIds: string[] = []) =>
      call(askMoreAttentionContract, { pathParams: { attentionId }, body: { recipientIds } }),
    cancelAttention: (attentionId: string) =>
      call(cancelAttentionContract, { pathParams: { attentionId } }),
    commitToPullRequest: (pullRequest: PullRequestRef, title: string) =>
      call(commitToPullRequestContract, { body: { pullRequest, title } }),
    releaseCommitment: (commitmentId: string) =>
      call(releaseCommitmentContract, { pathParams: { commitmentId } }),
  }
}
