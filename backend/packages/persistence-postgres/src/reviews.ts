import type {
  AiReviewRun,
  Reminder,
  ReminderStatus,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'
import type {
  AiReviewRunRepository,
  EpochMs,
  ReminderRepository,
  ReviewRequestRepository,
} from '@sainte-beuve/kernel'
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr, patched } from './rows.js'
import { aiReviewRuns, reminders, reviewRequests } from './schema.js'

/**
 * The board: the reviews a deployment has taken responsibility for, the nudges
 * scheduled against them, and the AI runs delegated from them.
 *
 * Every ordering here is the one the other two stores answer with, which is
 * what the conformance suite pins. There is a secondary sort on the id wherever
 * the primary one is a timestamp: two rows written in the same millisecond
 * otherwise come back in whichever order the planner chose, and a board that
 * reshuffles between two reads is one nobody can follow.
 */

export class PostgresReviewRequestRepository implements ReviewRequestRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async list(filter?: { status?: ReviewStatus[] }): Promise<ReviewRequest[]> {
    const wanted = filter?.status
    // A filter naming no status matches nothing. `inArray` with an empty list
    // renders as a false constant, which is right, but the read is free to
    // skip.
    if (wanted !== undefined && wanted.length === 0) return []
    const rows = await this.db
      .select()
      .from(reviewRequests)
      .where(wanted === undefined ? undefined : inArray(reviewRequests.status, wanted))
      .orderBy(desc(reviewRequests.createdAt), desc(reviewRequests.id))
    return rows.map((row) => row.data)
  }

  async getById(reviewId: string): Promise<ReviewRequest | null> {
    const rows = await this.db.select().from(reviewRequests).where(eq(reviewRequests.id, reviewId))
    return firstOr(rows)?.data ?? null
  }

  async getByPullRequest(ref: {
    owner: string
    repo: string
    number: number
  }): Promise<ReviewRequest | null> {
    const rows = await this.db
      .select()
      .from(reviewRequests)
      .where(
        and(
          eq(reviewRequests.prOwner, ref.owner),
          eq(reviewRequests.prRepo, ref.repo),
          eq(reviewRequests.prNumber, ref.number),
        ),
      )
    return firstOr(rows)?.data ?? null
  }

  async create(review: ReviewRequest): Promise<ReviewRequest> {
    await this.write(review)
    return review
  }

  async update(reviewId: string, patch: Partial<ReviewRequest>): Promise<ReviewRequest | null> {
    const current = await this.getById(reviewId)
    if (current === null) return null
    const next = patched(current, patch)
    await this.write(next)
    return next
  }

  private async write(review: ReviewRequest): Promise<void> {
    const row = {
      id: review.id,
      status: review.status,
      prOwner: review.pullRequest.owner,
      prRepo: review.pullRequest.repo,
      prNumber: review.pullRequest.number,
      createdAt: review.createdAt,
      data: review,
    }
    await this.db
      .insert(reviewRequests)
      .values(row)
      .onConflictDoUpdate({ target: reviewRequests.id, set: row })
  }
}

export class PostgresReminderRepository implements ReminderRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async listByReview(reviewId: string): Promise<Reminder[]> {
    const rows = await this.db
      .select()
      .from(reminders)
      .where(eq(reminders.reviewId, reviewId))
      .orderBy(asc(reminders.dueAt), asc(reminders.id))
    return rows.map((row) => row.data)
  }

  async listDue(now: EpochMs, limit: number): Promise<Reminder[]> {
    const rows = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.status, 'scheduled'), lte(reminders.dueAt, now)))
      .orderBy(asc(reminders.dueAt), asc(reminders.id))
      .limit(limit)
    return rows.map((row) => row.data)
  }

  async create(reminder: Reminder): Promise<Reminder> {
    await this.write(reminder)
    return reminder
  }

  async updateStatus(
    reminderId: string,
    status: ReminderStatus,
    fields?: { sentAt?: EpochMs; failureReason?: string },
  ): Promise<void> {
    const rows = await this.db.select().from(reminders).where(eq(reminders.id, reminderId))
    const current = firstOr(rows)?.data
    if (current === undefined) return
    await this.write({
      ...current,
      status,
      // An absent field keeps what is stored: a delivery that failed and was
      // retried must not lose the time the first attempt went out.
      sentAt: fields?.sentAt ?? current.sentAt,
      failureReason: fields?.failureReason ?? current.failureReason,
    })
  }

  async cancelScheduledForReview(reviewId: string): Promise<void> {
    // The status is a column AND a field of the payload, so this is a read and
    // a write rather than one `UPDATE`: a statement that moved the column
    // alone would leave every read reporting the nudge as still scheduled. The
    // set is one review's outstanding nudges, which the policy caps at a
    // handful.
    const rows = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.reviewId, reviewId), eq(reminders.status, 'scheduled')))
    for (const row of rows) {
      await this.write({ ...row.data, status: 'cancelled' })
    }
  }

  private async write(reminder: Reminder): Promise<void> {
    const row = {
      id: reminder.id,
      reviewId: reminder.reviewId,
      status: reminder.status,
      dueAt: reminder.dueAt,
      data: reminder,
    }
    await this.db.insert(reminders).values(row).onConflictDoUpdate({
      target: reminders.id,
      set: row,
    })
  }
}

export class PostgresAiReviewRunRepository implements AiReviewRunRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async listByReview(reviewId: string): Promise<AiReviewRun[]> {
    const rows = await this.db
      .select()
      .from(aiReviewRuns)
      .where(eq(aiReviewRuns.reviewId, reviewId))
      .orderBy(desc(aiReviewRuns.requestedAt), desc(aiReviewRuns.id))
    return rows.map((row) => row.data)
  }

  async getById(runId: string): Promise<AiReviewRun | null> {
    const rows = await this.db.select().from(aiReviewRuns).where(eq(aiReviewRuns.id, runId))
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
    const row = { id: run.id, reviewId: run.reviewId, requestedAt: run.requestedAt, data: run }
    await this.db
      .insert(aiReviewRuns)
      .values(row)
      .onConflictDoUpdate({ target: aiReviewRuns.id, set: row })
  }
}
