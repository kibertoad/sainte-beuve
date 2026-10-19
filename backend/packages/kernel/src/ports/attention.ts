import type { AttentionRequest, AttentionStatus, ReviewCommitment } from '@sainte-beuve/contracts'

/** The asks in flight, and the promises people made against pull requests. */

export interface AttentionRepository {
  list(filter?: { status?: AttentionStatus[] }): Promise<AttentionRequest[]>
  getById(attentionId: string): Promise<AttentionRequest | null>
  create(request: AttentionRequest): Promise<AttentionRequest>
  /**
   * Write a named ask, or answer the open one this requester already wrote
   * through here on that pull request. The store's unique key on
   * `(org, ownAskKey)` over open asks decides, so two submits landing together
   * get one ask and `created` is true for exactly one of them. The key is
   * released when the ask closes. Asks written by `create` carry no key.
   */
  createOrGetOwn(
    request: AttentionRequest,
  ): Promise<{ request: AttentionRequest; created: boolean }>
  /**
   * Change one request atomically. `change` is given the request as stored and
   * answers the fields to write, or null to leave it as it is. When another
   * write lands between the read and this one, the store reads again and calls
   * `change` again, so it must depend on nothing but the request it is given;
   * it may throw to refuse. Answers the request as it now stands, or null when
   * there is no such request.
   *
   * There is no plain update on purpose: every answer to an ask is a change to
   * what is already there, and two answering at once must both land.
   */
  change(
    attentionId: string,
    change: (current: AttentionRequest) => Partial<AttentionRequest> | null,
  ): Promise<AttentionRequest | null>
}

export interface ReviewCommitmentRepository {
  listByReviewer(reviewerId: string): Promise<ReviewCommitment[]>
  /**
   * Everybody's commitments on any of these pull requests, in no particular
   * order. A pull request is matched on its host as well as its path and
   * number, as `find` matches it.
   */
  listByPullRequests(
    pullRequests: readonly { provider: string; owner: string; repo: string; number: number }[],
  ): Promise<ReviewCommitment[]>
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
  /**
   * Write the commitment, or answer the one the reviewer already holds on that
   * pull request. One person holds at most one commitment per pull request, and
   * the store's unique key on `(org, reviewer, pullRequestKey)` enforces it, so
   * two clicks landing together get one row. `created` is true for the call
   * that wrote it and for no other, which is how only that call goes on to
   * request the reviewer on the host.
   *
   * There is no plain create on purpose: a lookup ahead of the write is the
   * race this closes.
   */
  createOrGet(
    commitment: ReviewCommitment,
  ): Promise<{ commitment: ReviewCommitment; created: boolean }>
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
