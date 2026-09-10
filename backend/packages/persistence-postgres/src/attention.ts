import type { AttentionRequest, AttentionStatus, ReviewCommitment } from '@sainte-beuve/contracts'
import type { AttentionRepository, ReviewCommitmentRepository } from '@sainte-beuve/kernel'
import { pullRequestKey } from '@sainte-beuve/kernel'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr, patched } from './rows.js'
import { attentionRequests, reviewCommitments } from './schema.js'

/** The asks in flight, and the promises people made against pull requests. */
export class PostgresAttentionRepository implements AttentionRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async list(filter?: { status?: AttentionStatus[] }): Promise<AttentionRequest[]> {
    const wanted = filter?.status
    if (wanted !== undefined && wanted.length === 0) return []
    const rows = await this.db
      .select()
      .from(attentionRequests)
      .where(wanted === undefined ? undefined : inArray(attentionRequests.status, wanted))
      .orderBy(desc(attentionRequests.createdAt), desc(attentionRequests.id))
    return rows.map((row) => row.data)
  }

  async getById(attentionId: string): Promise<AttentionRequest | null> {
    const rows = await this.db
      .select()
      .from(attentionRequests)
      .where(eq(attentionRequests.id, attentionId))
    return firstOr(rows)?.data ?? null
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
    const row = {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      data: request,
    }
    await this.db
      .insert(attentionRequests)
      .values(row)
      .onConflictDoUpdate({ target: attentionRequests.id, set: row })
  }
}

export class PostgresReviewCommitmentRepository implements ReviewCommitmentRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async listByReviewer(reviewerId: string): Promise<ReviewCommitment[]> {
    const rows = await this.db
      .select()
      .from(reviewCommitments)
      .where(eq(reviewCommitments.reviewerId, reviewerId))
      .orderBy(desc(reviewCommitments.createdAt), desc(reviewCommitments.id))
    return rows.map((row) => row.data)
  }

  async getById(commitmentId: string): Promise<ReviewCommitment | null> {
    const rows = await this.db
      .select()
      .from(reviewCommitments)
      .where(eq(reviewCommitments.id, commitmentId))
    return firstOr(rows)?.data ?? null
  }

  async find(
    reviewerId: string,
    pullRequest: { provider: string; owner: string; repo: string; number: number },
  ): Promise<ReviewCommitment | null> {
    const rows = await this.db
      .select()
      .from(reviewCommitments)
      .where(
        and(
          eq(reviewCommitments.reviewerId, reviewerId),
          eq(reviewCommitments.pullRequestKey, pullRequestKey(pullRequest)),
        ),
      )
      .orderBy(asc(reviewCommitments.createdAt), asc(reviewCommitments.id))
    return firstOr(rows)?.data ?? null
  }

  async create(commitment: ReviewCommitment): Promise<ReviewCommitment> {
    const row = {
      id: commitment.id,
      reviewerId: commitment.reviewerId,
      pullRequestKey: pullRequestKey(commitment.pullRequest),
      createdAt: commitment.createdAt,
      data: commitment,
    }
    await this.db
      .insert(reviewCommitments)
      .values(row)
      .onConflictDoUpdate({ target: reviewCommitments.id, set: row })
    return commitment
  }

  async delete(commitmentId: string): Promise<void> {
    await this.db.delete(reviewCommitments).where(eq(reviewCommitments.id, commitmentId))
  }
}
