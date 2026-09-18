import type {
  AiReviewRun,
  Reminder,
  ReminderStatus,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'
import {
  AI_REVIEW_IN_FLIGHT_STATUSES,
  aiReviewRunSchema,
  reminderSchema,
  reviewRequestSchema,
} from '@sainte-beuve/contracts'
import type {
  AiReviewRunRepository,
  EpochMs,
  ReminderRepository,
  ReviewRequestRepository,
} from '@sainte-beuve/kernel'
import type { SqlDriver, SqlParam } from './driver.js'
import { decodeData, decodeRows, encodeData, patched, placeholders } from './rows.js'

/**
 * The board: the reviews a deployment has taken responsibility for, the nudges
 * scheduled against them, and the AI runs delegated from them.
 *
 * Every ordering here is the one the in-memory store already answers with, and
 * the conformance suite is what keeps the three stores honest about it. There is
 * a secondary sort on the id wherever the primary one is a timestamp: two rows
 * written in the same millisecond otherwise come back in whichever order the
 * engine settled on, and a board that reshuffles between two reads is one nobody
 * can follow.
 */

const REVIEW_UPSERT = `INSERT INTO review_requests (org_id, id, status, pr_owner, pr_repo, pr_number, created_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (org_id, id) DO UPDATE SET
  status = excluded.status,
  pr_owner = excluded.pr_owner,
  pr_repo = excluded.pr_repo,
  pr_number = excluded.pr_number,
  created_at = excluded.created_at,
  data = excluded.data`

export class SqlReviewRequestRepository implements ReviewRequestRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list(filter?: { status?: ReviewStatus[]; limit?: number }): Promise<ReviewRequest[]> {
    const wanted = filter?.status
    // A filter naming no status matches nothing, and `IN ()` parses on neither
    // engine, so that answer is given without a statement.
    if (wanted !== undefined && wanted.length === 0) return []
    const where = wanted === undefined ? '' : ` AND status IN (${placeholders(wanted.length)})`
    // The cap is pushed into SQL, not applied to what came back: with
    // `review_requests_created_idx` the engine walks the newest rows and stops,
    // where a read of everything decodes a payload per row the caller drops.
    const cap = filter?.limit === undefined ? '' : ' LIMIT ?'
    const rows = await this.db.all(
      `SELECT data FROM review_requests WHERE org_id = ?${where} ORDER BY created_at DESC, id DESC${cap}`,
      [this.orgId, ...(wanted ?? []), ...(filter?.limit === undefined ? [] : [filter.limit])],
    )
    return decodeRows(reviewRequestSchema, 'review_requests', rows)
  }

  async getById(reviewId: string): Promise<ReviewRequest | null> {
    const row = await this.db.first(
      'SELECT data FROM review_requests WHERE org_id = ? AND id = ?',
      [this.orgId, reviewId],
    )
    return row === null ? null : decodeData(reviewRequestSchema, 'review_requests', row.data)
  }

  async getByPullRequest(ref: {
    owner: string
    repo: string
    number: number
  }): Promise<ReviewRequest | null> {
    const row = await this.db.first(
      'SELECT data FROM review_requests WHERE org_id = ? AND pr_owner = ? AND pr_repo = ? AND pr_number = ?',
      [this.orgId, ref.owner, ref.repo, ref.number],
    )
    return row === null ? null : decodeData(reviewRequestSchema, 'review_requests', row.data)
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
    const pr = review.pullRequest
    await this.db.run(REVIEW_UPSERT, [
      this.orgId,
      review.id,
      review.status,
      pr.owner,
      pr.repo,
      pr.number,
      review.createdAt,
      encodeData(review),
    ])
  }
}

const REMINDER_UPSERT = `INSERT INTO reminders (org_id, id, review_id, status, due_at, data)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (org_id, id) DO UPDATE SET
  review_id = excluded.review_id,
  status = excluded.status,
  due_at = excluded.due_at,
  data = excluded.data`

function reminderParams(orgId: string, reminder: Reminder): readonly SqlParam[] {
  return [
    orgId,
    reminder.id,
    reminder.reviewId,
    reminder.status,
    reminder.dueAt,
    encodeData(reminder),
  ]
}

export class SqlReminderRepository implements ReminderRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async listByReview(reviewId: string): Promise<Reminder[]> {
    const rows = await this.db.all(
      'SELECT data FROM reminders WHERE org_id = ? AND review_id = ? ORDER BY due_at, id',
      [this.orgId, reviewId],
    )
    return decodeRows(reminderSchema, 'reminders', rows)
  }

  async listDue(now: EpochMs, limit: number): Promise<Reminder[]> {
    const rows = await this.db.all(
      "SELECT data FROM reminders WHERE org_id = ? AND status = 'scheduled' AND due_at <= ? ORDER BY due_at, id LIMIT ?",
      [this.orgId, now, limit],
    )
    return decodeRows(reminderSchema, 'reminders', rows)
  }

  /**
   * ONE conditional statement: the status column, the payload and the guard
   * together, answering through `RETURNING` whether this caller took the row.
   *
   * `AND status = 'scheduled'` is the whole point. A `listDue` followed by an
   * unconditional write hands the same batch to every pass that reads it, and
   * two passes over one batch is what an overlapping cron invocation or a
   * second replica is. The payload is written whole rather than edited in
   * place, because the status lives in both and `json_set` is the dialect
   * branch this package exists not to have.
   */
  async claim(reminder: Reminder): Promise<boolean> {
    const claimed: Reminder = { ...reminder, status: 'sending' }
    const row = await this.db.first(
      `UPDATE reminders SET status = ?, data = ?
WHERE org_id = ? AND id = ? AND status = 'scheduled'
RETURNING id`,
      [claimed.status, encodeData(claimed), this.orgId, reminder.id],
    )
    return row !== null
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
    const row = await this.db.first('SELECT data FROM reminders WHERE org_id = ? AND id = ?', [
      this.orgId,
      reminderId,
    ])
    if (row === null) return
    const current = decodeData(reminderSchema, 'reminders', row.data)
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
    // Read then write, rather than one `UPDATE`, because the status lives in the
    // payload as well as in the column and the two must not disagree. Both
    // engines can edit JSON in place and they spell it differently, which is the
    // dialect branch this package exists not to have.
    //
    // The writes go in ONE batch: this runs on every status change and every
    // sent nudge, a statement per row would be a round trip per row inside a
    // Worker's time budget, and a batch is a transaction, so an interrupted
    // tick cannot leave a review with half its schedule cancelled.
    const rows = await this.db.all(
      "SELECT data FROM reminders WHERE org_id = ? AND review_id = ? AND status = 'scheduled'",
      [this.orgId, reviewId],
    )
    await this.db.batch(
      decodeRows(reminderSchema, 'reminders', rows).map((reminder) => ({
        sql: REMINDER_UPSERT,
        params: reminderParams(this.orgId, { ...reminder, status: 'cancelled' }),
      })),
    )
  }

  private async write(reminder: Reminder): Promise<void> {
    await this.db.run(REMINDER_UPSERT, reminderParams(this.orgId, reminder))
  }
}

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
