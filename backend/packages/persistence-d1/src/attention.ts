import type { AttentionRequest, AttentionStatus, ReviewCommitment } from '@sainte-beuve/contracts'
import { attentionRequestSchema, reviewCommitmentSchema } from '@sainte-beuve/contracts'
import type { AttentionRepository, ReviewCommitmentRepository } from '@sainte-beuve/kernel'
import { pullRequestKey } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData, patched, placeholders } from './rows.js'

/** The asks in flight, and the promises people made against pull requests. */

const ATTENTION_UPSERT = `INSERT INTO attention_requests (org_id, id, status, created_at, data)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (org_id, id) DO UPDATE SET
  status = excluded.status,
  created_at = excluded.created_at,
  data = excluded.data`

export class SqlAttentionRepository implements AttentionRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list(filter?: { status?: AttentionStatus[] }): Promise<AttentionRequest[]> {
    const wanted = filter?.status
    if (wanted !== undefined && wanted.length === 0) return []
    const where = wanted === undefined ? '' : ` AND status IN (${placeholders(wanted.length)})`
    const rows = await this.db.all(
      `SELECT data FROM attention_requests WHERE org_id = ?${where} ORDER BY created_at DESC, id DESC`,
      [this.orgId, ...(wanted ?? [])],
    )
    return decodeRows(attentionRequestSchema, 'attention_requests', rows)
  }

  async getById(attentionId: string): Promise<AttentionRequest | null> {
    const row = await this.db.first(
      'SELECT data FROM attention_requests WHERE org_id = ? AND id = ?',
      [this.orgId, attentionId],
    )
    return row === null ? null : decodeData(attentionRequestSchema, 'attention_requests', row.data)
  }

  async create(request: AttentionRequest): Promise<AttentionRequest> {
    await this.write(request)
    return request
  }

  async update(
    attentionId: string,
    patch: Partial<AttentionRequest>,
  ): Promise<AttentionRequest | null> {
    const current = await this.getById(attentionId)
    if (current === null) return null
    const next = patched(current, patch)
    await this.write(next)
    return next
  }

  private async write(request: AttentionRequest): Promise<void> {
    await this.db.run(ATTENTION_UPSERT, [
      this.orgId,
      request.id,
      request.status,
      request.createdAt,
      encodeData(request),
    ])
  }
}

const COMMITMENT_UPSERT = `INSERT INTO review_commitments (org_id, id, reviewer_id, pull_request_key, created_at, data)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (org_id, id) DO UPDATE SET
  reviewer_id = excluded.reviewer_id,
  pull_request_key = excluded.pull_request_key,
  created_at = excluded.created_at,
  data = excluded.data`

export class SqlReviewCommitmentRepository implements ReviewCommitmentRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async listByReviewer(reviewerId: string): Promise<ReviewCommitment[]> {
    const rows = await this.db.all(
      'SELECT data FROM review_commitments WHERE org_id = ? AND reviewer_id = ? ORDER BY created_at DESC, id DESC',
      [this.orgId, reviewerId],
    )
    return decodeRows(reviewCommitmentSchema, 'review_commitments', rows)
  }

  async getById(commitmentId: string): Promise<ReviewCommitment | null> {
    const row = await this.db.first(
      'SELECT data FROM review_commitments WHERE org_id = ? AND id = ?',
      [this.orgId, commitmentId],
    )
    return row === null ? null : decodeData(reviewCommitmentSchema, 'review_commitments', row.data)
  }

  async find(
    reviewerId: string,
    pullRequest: { provider: string; owner: string; repo: string; number: number },
  ): Promise<ReviewCommitment | null> {
    // The HOST is part of the key, not decoration: `platform/api#12` exists on
    // GitHub and on GitLab, and matching on the path alone would answer the
    // second with the first and put the wrong host's pull request on somebody's
    // workspace.
    const row = await this.db.first(
      'SELECT data FROM review_commitments WHERE org_id = ? AND reviewer_id = ? AND pull_request_key = ? ORDER BY created_at, id',
      [this.orgId, reviewerId, pullRequestKey(pullRequest)],
    )
    return row === null ? null : decodeData(reviewCommitmentSchema, 'review_commitments', row.data)
  }

  async create(commitment: ReviewCommitment): Promise<ReviewCommitment> {
    await this.db.run(COMMITMENT_UPSERT, [
      this.orgId,
      commitment.id,
      commitment.reviewerId,
      pullRequestKey(commitment.pullRequest),
      commitment.createdAt,
      encodeData(commitment),
    ])
    return commitment
  }

  async delete(commitmentId: string): Promise<void> {
    await this.db.run('DELETE FROM review_commitments WHERE org_id = ? AND id = ?', [
      this.orgId,
      commitmentId,
    ])
  }
}
