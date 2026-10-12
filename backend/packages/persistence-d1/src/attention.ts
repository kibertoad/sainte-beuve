import type { AttentionRequest, AttentionStatus, ReviewCommitment } from '@sainte-beuve/contracts'
import { attentionRequestSchema, reviewCommitmentSchema } from '@sainte-beuve/contracts'
import type { AttentionRepository, ReviewCommitmentRepository } from '@sainte-beuve/kernel'
import { pullRequestKey, writeAtRevision } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData, patched, placeholders } from './rows.js'

/** The asks in flight, and the promises people made against pull requests. */

// A create over an existing id moves the revision on as well, so a change that
// read the row before it loses its race instead of writing over the new one.
const ATTENTION_UPSERT = `INSERT INTO attention_requests (org_id, id, status, created_at, data, revision)
VALUES (?, ?, ?, ?, ?, 0)
ON CONFLICT (org_id, id) DO UPDATE SET
  status = excluded.status,
  created_at = excluded.created_at,
  data = excluded.data,
  revision = attention_requests.revision + 1`

const ATTENTION_WRITE_IF = `UPDATE attention_requests
SET status = ?, data = ?, revision = revision + 1
WHERE org_id = ? AND id = ? AND revision = ?
RETURNING id`

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

  async change(
    attentionId: string,
    change: (current: AttentionRequest) => Partial<AttentionRequest> | null,
  ): Promise<AttentionRequest | null> {
    return writeAtRevision({
      describe: `Attention request ${attentionId}`,
      read: async () => {
        const row = await this.db.first(
          'SELECT data, revision FROM attention_requests WHERE org_id = ? AND id = ?',
          [this.orgId, attentionId],
        )
        if (row === null) return null
        const value = decodeData(attentionRequestSchema, 'attention_requests', row.data)
        return { value, revision: Number(row.revision) }
      },
      change: (current) => {
        const patch = change(current)
        return patch === null ? null : patched(current, patch)
      },
      writeIf: async (next, expected) => {
        const row = await this.db.first(ATTENTION_WRITE_IF, [
          next.status,
          encodeData(next),
          this.orgId,
          attentionId,
          expected,
        ])
        return row !== null
      },
    })
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

  /** An UPDATE rather than the upsert, so a row released since the read stays gone. */
  async setRequestedHandle(
    commitmentId: string,
    requestedHandle: string | null,
  ): Promise<ReviewCommitment | null> {
    const current = await this.getById(commitmentId)
    if (current === null) return null
    const next = { ...current, requestedHandle }
    const row = await this.db.first(
      'UPDATE review_commitments SET data = ? WHERE org_id = ? AND id = ? RETURNING id',
      [encodeData(next), this.orgId, commitmentId],
    )
    return row === null ? null : next
  }

  async delete(commitmentId: string): Promise<void> {
    await this.db.run('DELETE FROM review_commitments WHERE org_id = ? AND id = ?', [
      this.orgId,
      commitmentId,
    ])
  }
}
