import type {
  AiReviewRun,
  Reminder,
  ReminderStatus,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'
import { AI_REVIEW_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'
import type {
  AiReviewRunRepository,
  EpochMs,
  ReminderRepository,
  ReviewRequestRepository,
} from '@sainte-beuve/kernel'
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm'
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
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async list(filter?: { status?: ReviewStatus[] }): Promise<ReviewRequest[]> {
    const wanted = filter?.status
    // A filter naming no status matches nothing. `inArray` with an empty list
    // renders as a false constant, which is right, but the read is free to
    // skip.
    if (wanted !== undefined && wanted.length === 0) return []
    const rows = await this.db
      .select()
      .from(reviewRequests)
      .where(
        and(
          eq(reviewRequests.orgId, this.orgId),
          wanted === undefined ? undefined : inArray(reviewRequests.status, wanted),
        ),
      )
      .orderBy(desc(reviewRequests.createdAt), desc(reviewRequests.id))
    return rows.map((row) => row.data)
  }

  async getById(reviewId: string): Promise<ReviewRequest | null> {
    const rows = await this.db
      .select()
      .from(reviewRequests)
      .where(and(eq(reviewRequests.orgId, this.orgId), eq(reviewRequests.id, reviewId)))
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
          eq(reviewRequests.orgId, this.orgId),
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
      orgId: this.orgId,
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
      .onConflictDoUpdate({ target: [reviewRequests.orgId, reviewRequests.id], set: row })
  }
}

function reminderRow(orgId: string, reminder: Reminder) {
  return {
    orgId,
    id: reminder.id,
    reviewId: reminder.reviewId,
    status: reminder.status,
    dueAt: reminder.dueAt,
    data: reminder,
  }
}

/**
 * The conflict branch, written against `excluded` rather than against one
 * row's values, so the same upsert takes a single reminder or a whole review's
 * worth in one statement.
 */
const REMINDER_CONFLICT = {
  target: [reminders.orgId, reminders.id],
  set: {
    reviewId: sql`excluded.review_id`,
    status: sql`excluded.status`,
    dueAt: sql`excluded.due_at`,
    data: sql`excluded.data`,
  },
}

export class PostgresReminderRepository implements ReminderRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async listByReview(reviewId: string): Promise<Reminder[]> {
    const rows = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.orgId, this.orgId), eq(reminders.reviewId, reviewId)))
      .orderBy(asc(reminders.dueAt), asc(reminders.id))
    return rows.map((row) => row.data)
  }

  async listDue(now: EpochMs, limit: number): Promise<Reminder[]> {
    const rows = await this.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.orgId, this.orgId),
          eq(reminders.status, 'scheduled'),
          lte(reminders.dueAt, now),
        ),
      )
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
    const rows = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.orgId, this.orgId), eq(reminders.id, reminderId)))
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
    // alone would leave every read reporting the nudge as still scheduled.
    //
    // The write is ONE multi-row upsert. This runs on every status change and
    // every sent nudge, a statement per row would be a round trip per row, and
    // a single statement is atomic, so an interrupted tick cannot leave a
    // review with half its schedule cancelled.
    const rows = await this.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.orgId, this.orgId),
          eq(reminders.reviewId, reviewId),
          eq(reminders.status, 'scheduled'),
        ),
      )
    if (rows.length === 0) return
    await this.db
      .insert(reminders)
      .values(rows.map((row) => reminderRow(this.orgId, { ...row.data, status: 'cancelled' })))
      .onConflictDoUpdate(REMINDER_CONFLICT)
  }

  private async write(reminder: Reminder): Promise<void> {
    await this.db
      .insert(reminders)
      .values(reminderRow(this.orgId, reminder))
      .onConflictDoUpdate(REMINDER_CONFLICT)
  }
}

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
