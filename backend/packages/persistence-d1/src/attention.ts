import type { AttentionRequest, AttentionStatus, ReviewCommitment } from '@sainte-beuve/contracts'
import { attentionRequestSchema, reviewCommitmentSchema } from '@sainte-beuve/contracts'
import type { AttentionRepository, ReviewCommitmentRepository } from '@sainte-beuve/kernel'
import { ConflictError, insertOrRead, pullRequestKey, writeAtRevision } from '@sainte-beuve/kernel'
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
SET status = ?, created_at = ?, data = ?, revision = revision + 1
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
          next.createdAt,
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

/** D1 binds at most 100 parameters per statement; one is the org. */
const KEYS_PER_READ = 90

// No conflict target: a taken id loses the same way a taken
// `(org_id, reviewer_id, pull_request_key)` does, and writes nothing.
const COMMITMENT_INSERT = `INSERT INTO review_commitments (org_id, id, reviewer_id, pull_request_key, created_at, data)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT DO NOTHING
RETURNING id`

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

  async listByPullRequests(
    pullRequests: readonly { provider: string; owner: string; repo: string; number: number }[],
  ): Promise<ReviewCommitment[]> {
    const keys = [...new Set(pullRequests.map(pullRequestKey))]
    const found: ReviewCommitment[] = []
    for (let start = 0; start < keys.length; start += KEYS_PER_READ) {
      const chunk = keys.slice(start, start + KEYS_PER_READ)
      const rows = await this.db.all(
        `SELECT data FROM review_commitments WHERE org_id = ? AND pull_request_key IN (${placeholders(chunk.length)})`,
        [this.orgId, ...chunk],
      )
      found.push(...decodeRows(reviewCommitmentSchema, 'review_commitments', rows))
    }
    return found
  }

  async find(
    reviewerId: string,
    pullRequest: { provider: string; owner: string; repo: string; number: number },
  ): Promise<ReviewCommitment | null> {
    const row = await this.db.first(
      'SELECT data FROM review_commitments WHERE org_id = ? AND reviewer_id = ? AND pull_request_key = ?',
      [this.orgId, reviewerId, pullRequestKey(pullRequest)],
    )
    return row === null ? null : decodeData(reviewCommitmentSchema, 'review_commitments', row.data)
  }

  async createOrGet(
    commitment: ReviewCommitment,
  ): Promise<{ commitment: ReviewCommitment; created: boolean }> {
    const key = pullRequestKey(commitment.pullRequest)
    const { value, created } = await insertOrRead(commitment, {
      describe: `The commitment of ${commitment.reviewerId} on ${key}`,
      insert: async () => {
        const row = await this.db.first(COMMITMENT_INSERT, [
          this.orgId,
          commitment.id,
          commitment.reviewerId,
          key,
          commitment.createdAt,
          encodeData(commitment),
        ])
        return row !== null
      },
      read: () => this.holderOf(commitment),
    })
    return { commitment: value, created }
  }

  /** An UPDATE rather than an insert, so a row released since the read stays gone. */
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

  /**
   * The commitment that holds this one's key. An insert that lost while no row
   * holds the key lost on the id, which no retry can win.
   */
  private async holderOf(commitment: ReviewCommitment): Promise<ReviewCommitment | null> {
    const held = await this.find(commitment.reviewerId, commitment.pullRequest)
    if (held !== null || (await this.getById(commitment.id)) === null) return held
    throw new ConflictError(`Commitment ${commitment.id} is already taken`, {
      commitmentId: commitment.id,
    })
  }
}
