import type { AttentionRequest, AttentionStatus, ReviewCommitment } from '@sainte-beuve/contracts'

/** The asks in flight, and the promises people made against pull requests. */

export interface AttentionRepository {
  list(filter?: { status?: AttentionStatus[] }): Promise<AttentionRequest[]>
  getById(attentionId: string): Promise<AttentionRequest | null>
  create(request: AttentionRequest): Promise<AttentionRequest>
  update(attentionId: string, patch: Partial<AttentionRequest>): Promise<AttentionRequest | null>
}

export interface ReviewCommitmentRepository {
  listByReviewer(reviewerId: string): Promise<ReviewCommitment[]>
  getById(commitmentId: string): Promise<ReviewCommitment | null>
  /**
   * What one person already promised about one pull request, so a second click
   * is a no-op.
   *
   * The `provider` is part of the key, not decoration: `platform/api#12` on
   * GitHub and `platform/api#12` on GitLab are two different changes, and a
   * lookup that matched on the path alone would answer the second with the
   * first, leave no commitment row for it, and put the wrong host's pull
   * request on somebody's workspace.
   */
  find(
    reviewerId: string,
    pullRequest: { provider: string; owner: string; repo: string; number: number },
  ): Promise<ReviewCommitment | null>
  create(commitment: ReviewCommitment): Promise<ReviewCommitment>
  /**
   * Record which host request the commitment holds. Answers null, and writes
   * nothing, when the commitment has been released: a released one must not
   * come back, nor claim a request nobody will take back.
   */
  setRequestedHandle(
    commitmentId: string,
    requestedHandle: string | null,
  ): Promise<ReviewCommitment | null>
  delete(commitmentId: string): Promise<void>
}
