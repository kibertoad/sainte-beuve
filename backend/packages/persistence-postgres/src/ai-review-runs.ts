import type { AiReviewRun } from '@sainte-beuve/contracts'
import { AI_REVIEW_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'
import type { AiReviewRunRepository } from '@sainte-beuve/kernel'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr, patched } from './rows.js'
import { aiReviewRuns } from './schema.js'

/**
 * The AI runs delegated from the board's reviews, in the order the clock polls
 * them. The same orderings as the other two stores, pinned by the conformance
 * suite.
 */
export class PostgresAiReviewRunRepository implements AiReviewRunRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async listByReview(reviewId: string): Promise<AiReviewRun[]> {
    const rows = await this.db
      .select()
      .from(aiReviewRuns)
      .where(and(eq(aiReviewRuns.orgId, this.orgId), eq(aiReviewRuns.reviewId, reviewId)))
      .orderBy(desc(aiReviewRuns.requestedAt), desc(aiReviewRuns.id))
    return rows.map((row) => row.data)
  }

  async listByReviews(reviewIds: readonly string[]): Promise<AiReviewRun[]> {
    if (reviewIds.length === 0) return []
    const rows = await this.db
      .select()
      .from(aiReviewRuns)
      .where(
        and(
          eq(aiReviewRuns.orgId, this.orgId),
          inArray(aiReviewRuns.reviewId, [...new Set(reviewIds)]),
        ),
      )
    return rows.map((row) => row.data)
  }

  async listInFlight(limit: number): Promise<AiReviewRun[]> {
    const rows = await this.db
      .select()
      .from(aiReviewRuns)
      .where(
        and(
          eq(aiReviewRuns.orgId, this.orgId),
          inArray(aiReviewRuns.status, [...AI_REVIEW_IN_FLIGHT_STATUSES]),
        ),
      )
      // `NULLS FIRST` spelled out: Postgres sorts nulls LAST on an ascending
      // key, and a run nobody has polled yet is the one that most needs polling.
      // The other two stores answer the same way; the conformance suite pins it.
      .orderBy(
        sql`${aiReviewRuns.lastPolledAt} asc nulls first`,
        asc(aiReviewRuns.requestedAt),
        asc(aiReviewRuns.id),
      )
      .limit(limit)
    return rows.map((row) => row.data)
  }

  async getById(runId: string): Promise<AiReviewRun | null> {
    const rows = await this.db
      .select()
      .from(aiReviewRuns)
      .where(and(eq(aiReviewRuns.orgId, this.orgId), eq(aiReviewRuns.id, runId)))
    return firstOr(rows)?.data ?? null
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
    const row = {
      orgId: this.orgId,
      id: run.id,
      reviewId: run.reviewId,
      status: run.status,
      requestedAt: run.requestedAt,
      lastPolledAt: run.lastPolledAt,
      data: run,
    }
    await this.db
      .insert(aiReviewRuns)
      .values(row)
      .onConflictDoUpdate({ target: [aiReviewRuns.orgId, aiReviewRuns.id], set: row })
  }
}
