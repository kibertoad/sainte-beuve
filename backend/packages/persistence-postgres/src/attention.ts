import type { AttentionRequest, AttentionStatus, ReviewCommitment } from '@sainte-beuve/contracts'
import type { AttentionRepository, ReviewCommitmentRepository } from '@sainte-beuve/kernel'
import { insertOrRead, pullRequestKey, writeAtRevision } from '@sainte-beuve/kernel'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr, patched } from './rows.js'
import { attentionRequests, reviewCommitments } from './schema.js'

/** The asks in flight, and the promises people made against pull requests. */
export class PostgresAttentionRepository implements AttentionRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async list(filter?: { status?: AttentionStatus[] }): Promise<AttentionRequest[]> {
    const wanted = filter?.status
    if (wanted !== undefined && wanted.length === 0) return []
    const rows = await this.db
      .select()
      .from(attentionRequests)
      .where(
        and(
          eq(attentionRequests.orgId, this.orgId),
          wanted === undefined ? undefined : inArray(attentionRequests.status, wanted),
        ),
      )
      .orderBy(desc(attentionRequests.createdAt), desc(attentionRequests.id))
    return rows.map((row) => row.data)
  }

  async getById(attentionId: string): Promise<AttentionRequest | null> {
    const rows = await this.db
      .select()
      .from(attentionRequests)
      .where(and(eq(attentionRequests.orgId, this.orgId), eq(attentionRequests.id, attentionId)))
    return firstOr(rows)?.data ?? null
  }

  async create(request: AttentionRequest): Promise<AttentionRequest> {
    await this.write(request)
    return request
  }

  async change(
    attentionId: string,
    change: (current: AttentionRequest) => Partial<AttentionRequest> | null,
  ): Promise<AttentionRequest | null> {
    const row = and(eq(attentionRequests.orgId, this.orgId), eq(attentionRequests.id, attentionId))
    return writeAtRevision({
      describe: `Attention request ${attentionId}`,
      read: async () => {
        const rows = await this.db.select().from(attentionRequests).where(row)
        const found = firstOr(rows)
        return found === null ? null : { value: found.data, revision: found.revision }
      },
      change: (current) => {
        const patch = change(current)
        return patch === null ? null : patched(current, patch)
      },
      writeIf: async (next, expected) => {
        const written = await this.db
          .update(attentionRequests)
          .set({
            status: next.status,
            createdAt: next.createdAt,
            data: next,
            revision: expected + 1,
          })
          .where(and(row, eq(attentionRequests.revision, expected)))
          .returning({ id: attentionRequests.id })
        return written.length > 0
      },
    })
  }

  private async write(request: AttentionRequest): Promise<void> {
    const row = {
      orgId: this.orgId,
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      data: request,
    }
    // A create over an existing id moves the revision on as well, so a change
    // that read the row before it loses its race instead of writing over it.
    await this.db
      .insert(attentionRequests)
      .values(row)
      .onConflictDoUpdate({
        target: [attentionRequests.orgId, attentionRequests.id],
        set: { ...row, revision: sql`${attentionRequests.revision} + 1` },
      })
  }
}

export class PostgresReviewCommitmentRepository implements ReviewCommitmentRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async listByReviewer(reviewerId: string): Promise<ReviewCommitment[]> {
    const rows = await this.db
      .select()
      .from(reviewCommitments)
      .where(
        and(eq(reviewCommitments.orgId, this.orgId), eq(reviewCommitments.reviewerId, reviewerId)),
      )
      .orderBy(desc(reviewCommitments.createdAt), desc(reviewCommitments.id))
    return rows.map((row) => row.data)
  }

  async getById(commitmentId: string): Promise<ReviewCommitment | null> {
    const rows = await this.db
      .select()
      .from(reviewCommitments)
      .where(and(eq(reviewCommitments.orgId, this.orgId), eq(reviewCommitments.id, commitmentId)))
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
          eq(reviewCommitments.orgId, this.orgId),
          eq(reviewCommitments.reviewerId, reviewerId),
          eq(reviewCommitments.pullRequestKey, pullRequestKey(pullRequest)),
        ),
      )
    return firstOr(rows)?.data ?? null
  }

  /** `ON CONFLICT DO NOTHING` names no target, so a taken id loses the same way a taken key does. */
  async createOrGet(
    commitment: ReviewCommitment,
  ): Promise<{ commitment: ReviewCommitment; created: boolean }> {
    const row = {
      orgId: this.orgId,
      id: commitment.id,
      reviewerId: commitment.reviewerId,
      pullRequestKey: pullRequestKey(commitment.pullRequest),
      createdAt: commitment.createdAt,
      data: commitment,
    }
    const { value, created } = await insertOrRead(commitment, {
      describe: `The commitment of ${commitment.reviewerId} on ${row.pullRequestKey}`,
      insert: async () => {
        const inserted = await this.db
          .insert(reviewCommitments)
          .values(row)
          .onConflictDoNothing()
          .returning({ id: reviewCommitments.id })
        return firstOr(inserted) !== null
      },
      read: () => this.find(commitment.reviewerId, commitment.pullRequest),
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
    const updated = await this.db
      .update(reviewCommitments)
      .set({ data: next })
      .where(and(eq(reviewCommitments.orgId, this.orgId), eq(reviewCommitments.id, commitmentId)))
      .returning({ id: reviewCommitments.id })
    return firstOr(updated) === null ? null : next
  }

  async delete(commitmentId: string): Promise<void> {
    await this.db
      .delete(reviewCommitments)
      .where(and(eq(reviewCommitments.orgId, this.orgId), eq(reviewCommitments.id, commitmentId)))
  }
}
