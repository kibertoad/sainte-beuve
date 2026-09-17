import type { Reviewer } from '@sainte-beuve/contracts'
import { reviewerSchema } from '@sainte-beuve/contracts'
import type { ReviewerRepository } from '@sainte-beuve/kernel'
import type { SqlDriver, SqlRow } from './driver.js'
import { decodeCount, decodeData, encodeData, patched } from './rows.js'

/**
 * The reviewer directory.
 *
 * The one store with a column that is not derived from its payload (see
 * `rows.ts`): `adjustOutstanding` increments, and two assignments landing in the
 * same second must both count. So the counter is a column, the adjustment is one
 * `UPDATE`, and every read overlays the column onto the decoded row.
 *
 * Which is why the counter is absent from the conflict branch below: the column
 * is written when the row is INSERTED and moved by nothing but
 * `adjustOutstanding` afterwards. A `DO UPDATE SET` that wrote it from the
 * payload would let a patch built a moment earlier (`update` reads, then
 * writes) discard an assignment that landed in between, and the counter would
 * walk backwards every time a rename raced a review.
 */

const SELECT = 'SELECT outstanding_reviews, data FROM reviewers WHERE org_id = ?'

const UPSERT = `INSERT INTO reviewers (org_id, id, outstanding_reviews, created_at, data)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (org_id, id) DO UPDATE SET
  created_at = excluded.created_at,
  data = excluded.data`

// `MAX(a, b)` is SQLite's two-argument maximum, which is a scalar here and an
// aggregate in Postgres; the Drizzle adapter spells the same floor `GREATEST`.
const ADJUST =
  'UPDATE reviewers SET outstanding_reviews = MAX(outstanding_reviews + ?, 0) WHERE org_id = ? AND id = ?'

function toReviewer(row: SqlRow): Reviewer {
  return {
    ...decodeData(reviewerSchema, 'reviewers', row.data),
    outstandingReviews: decodeCount(row.outstanding_reviews),
  }
}

export class SqlReviewerRepository implements ReviewerRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list(): Promise<Reviewer[]> {
    const rows = await this.db.all(`${SELECT} ORDER BY created_at, id`, [this.orgId])
    return rows.map(toReviewer)
  }

  async getById(reviewerId: string): Promise<Reviewer | null> {
    const row = await this.db.first(`${SELECT} AND id = ?`, [this.orgId, reviewerId])
    return row === null ? null : toReviewer(row)
  }

  async create(reviewer: Reviewer): Promise<Reviewer> {
    await this.write(reviewer)
    return reviewer
  }

  async update(reviewerId: string, patch: Partial<Reviewer>): Promise<Reviewer | null> {
    const current = await this.getById(reviewerId)
    if (current === null) return null
    // The counter comes from the COLUMN that `getById` just overlaid, never
    // from the patch. Putting it back leaves the payload, the column and the
    // row this answers with all saying the same number.
    const next = patched(current, { ...patch, outstandingReviews: current.outstandingReviews })
    await this.write(next)
    return next
  }

  async adjustOutstanding(reviewerId: string, delta: number): Promise<void> {
    await this.db.run(ADJUST, [delta, this.orgId, reviewerId])
  }

  private async write(reviewer: Reviewer): Promise<void> {
    await this.db.run(UPSERT, [
      this.orgId,
      reviewer.id,
      reviewer.outstandingReviews,
      reviewer.createdAt,
      encodeData(reviewer),
    ])
  }
}
