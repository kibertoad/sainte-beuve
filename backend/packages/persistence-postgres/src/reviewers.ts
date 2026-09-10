import type { Reviewer } from '@sainte-beuve/contracts'
import type { ReviewerRepository } from '@sainte-beuve/kernel'
import { asc, eq, sql } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr, patched } from './rows.js'
import { reviewers } from './schema.js'

/**
 * The reviewer directory.
 *
 * `outstanding_reviews` is the one column not derived from the payload:
 * `adjustOutstanding` INCREMENTS, so two assignments landing together must both
 * count, and a read-modify-write would lose one of them. The statement is a
 * single `UPDATE` and every read overlays the column onto the decoded row.
 *
 * `GREATEST` rather than a branch: a review resolved twice (a webhook replay, a
 * Slack button pressed after the approval landed) must not leave somebody owing
 * minus one review, which would make selection prefer them for ever.
 */
type ReviewerRow = typeof reviewers.$inferSelect

function toReviewer(row: ReviewerRow): Reviewer {
  return { ...row.data, outstandingReviews: row.outstandingReviews }
}

export class PostgresReviewerRepository implements ReviewerRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async list(): Promise<Reviewer[]> {
    const rows = await this.db
      .select()
      .from(reviewers)
      .orderBy(asc(reviewers.createdAt), asc(reviewers.id))
    return rows.map(toReviewer)
  }

  async getById(reviewerId: string): Promise<Reviewer | null> {
    const rows = await this.db.select().from(reviewers).where(eq(reviewers.id, reviewerId))
    const row = firstOr(rows)
    return row === null ? null : toReviewer(row)
  }

  async create(reviewer: Reviewer): Promise<Reviewer> {
    await this.write(reviewer)
    return reviewer
  }

  async update(reviewerId: string, patch: Partial<Reviewer>): Promise<Reviewer | null> {
    const current = await this.getById(reviewerId)
    if (current === null) return null
    const next = patched(current, patch)
    await this.write(next)
    return next
  }

  async adjustOutstanding(reviewerId: string, delta: number): Promise<void> {
    await this.db
      .update(reviewers)
      .set({
        outstandingReviews: sql`GREATEST(${reviewers.outstandingReviews} + ${delta}, 0)`,
      })
      .where(eq(reviewers.id, reviewerId))
  }

  private async write(reviewer: Reviewer): Promise<void> {
    const row = {
      id: reviewer.id,
      outstandingReviews: reviewer.outstandingReviews,
      createdAt: reviewer.createdAt,
      data: reviewer,
    }
    await this.db
      .insert(reviewers)
      .values(row)
      .onConflictDoUpdate({ target: reviewers.id, set: row })
  }
}
