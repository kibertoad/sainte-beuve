import type { AiReviewRun } from '@sainte-beuve/contracts'
import { AI_REVIEW_IN_FLIGHT_STATUSES, aiReviewRunSchema } from '@sainte-beuve/contracts'
import type { AiReviewRunRepository } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData, patched, placeholders } from './rows.js'

/** D1 binds at most 100 parameters per statement; one is the org. */
const IDS_PER_READ = 90

const RUN_UPSERT = `INSERT INTO ai_review_runs (org_id, id, review_id, status, requested_at, last_polled_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (org_id, id) DO UPDATE SET
  review_id = excluded.review_id,
  status = excluded.status,
  requested_at = excluded.requested_at,
  last_polled_at = excluded.last_polled_at,
  data = excluded.data`

/**
 * `AI_REVIEW_IN_FLIGHT_STATUSES` as the `IN (...)` list the clock's read needs,
 * in the rotation `AiReviewRunRepository.listInFlight` documents.
 *
 * `NULLS FIRST` is spelled out rather than left to the engine. SQLite already
 * sorts nulls first on an ascending key, but Postgres sorts them last and this
 * read has to answer the same way on both, so neither store leans on its default.
 */
const IN_FLIGHT = `SELECT data FROM ai_review_runs
WHERE org_id = ? AND status IN (${placeholders(AI_REVIEW_IN_FLIGHT_STATUSES.length)})
ORDER BY last_polled_at ASC NULLS FIRST, requested_at, id
LIMIT ?`

/**
 * The AI runs delegated from the board's reviews, in the order the clock polls
 * them. The same orderings as the other two stores, pinned by the conformance
 * suite.
 */
export class SqlAiReviewRunRepository implements AiReviewRunRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async listByReview(reviewId: string): Promise<AiReviewRun[]> {
    const rows = await this.db.all(
      'SELECT data FROM ai_review_runs WHERE org_id = ? AND review_id = ? ORDER BY requested_at DESC, id DESC',
      [this.orgId, reviewId],
    )
    return decodeRows(aiReviewRunSchema, 'ai_review_runs', rows)
  }

  async listByReviews(reviewIds: readonly string[]): Promise<AiReviewRun[]> {
    const ids = [...new Set(reviewIds)]
    const found: AiReviewRun[] = []
    for (let start = 0; start < ids.length; start += IDS_PER_READ) {
      const chunk = ids.slice(start, start + IDS_PER_READ)
      const rows = await this.db.all(
        `SELECT data FROM ai_review_runs WHERE org_id = ? AND review_id IN (${placeholders(chunk.length)})`,
        [this.orgId, ...chunk],
      )
      found.push(...decodeRows(aiReviewRunSchema, 'ai_review_runs', rows))
    }
    return found
  }

  async listInFlight(limit: number): Promise<AiReviewRun[]> {
    const rows = await this.db.all(IN_FLIGHT, [this.orgId, ...AI_REVIEW_IN_FLIGHT_STATUSES, limit])
    return decodeRows(aiReviewRunSchema, 'ai_review_runs', rows)
  }

  async getById(runId: string): Promise<AiReviewRun | null> {
    const row = await this.db.first('SELECT data FROM ai_review_runs WHERE org_id = ? AND id = ?', [
      this.orgId,
      runId,
    ])
    return row === null ? null : decodeData(aiReviewRunSchema, 'ai_review_runs', row.data)
  }

  async create(run: AiReviewRun): Promise<AiReviewRun> {
    await this.write(run)
    return run
  }

  async update(runId: string, patch: Partial<AiReviewRun>): Promise<AiReviewRun | null> {
    const current = await this.getById(runId)
    if (current === null) return null
    const next = patched(current, patch)
    await this.write(next)
    return next
  }

  private async write(run: AiReviewRun): Promise<void> {
    await this.db.run(RUN_UPSERT, [
      this.orgId,
      run.id,
      run.reviewId,
      run.status,
      run.requestedAt,
      run.lastPolledAt,
      encodeData(run),
    ])
  }
}
