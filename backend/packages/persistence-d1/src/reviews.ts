import type {
  ProjectRef,
  Reminder,
  ReminderStatus,
  ReviewRequest,
  ReviewStatus,
} from '@sainte-beuve/contracts'
import { reminderSchema, reviewRequestSchema } from '@sainte-beuve/contracts'
import type {
  EpochMs,
  PullRequestAddress,
  ReminderRepository,
  ReviewListOrder,
  ReviewRequestRepository,
} from '@sainte-beuve/kernel'
import { projectRefKey, pullRequestKey } from '@sainte-beuve/kernel'
import type { SqlDriver, SqlParam } from './driver.js'
import { decodeData, decodeRows, encodeData, patched, placeholders } from './rows.js'

/**
 * The board: the reviews a deployment has taken responsibility for, the nudges
 * scheduled against them. The AI runs delegated from them are in
 * `ai-review-runs.ts`.
 *
 * Every ordering here is the one the in-memory store already answers with, and
 * the conformance suite is what keeps the three stores honest about it. There is
 * a secondary sort on the id wherever the primary one is a timestamp: two rows
 * written in the same millisecond otherwise come back in whichever order the
 * engine settled on, and a board that reshuffles between two reads is one nobody
 * can follow.
 */

/** D1 binds at most 100 parameters per statement; one is the org. */
const KEYS_PER_READ = 90

const REVIEW_UPSERT = `INSERT INTO review_requests (org_id, id, status, pull_request_key, repo_key, created_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (org_id, id) DO UPDATE SET
  status = excluded.status,
  pull_request_key = excluded.pull_request_key,
  repo_key = excluded.repo_key,
  created_at = excluded.created_at,
  data = excluded.data`

export class SqlReviewRequestRepository implements ReviewRequestRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list(filter?: {
    status?: ReviewStatus[]
    limit?: number
    order?: ReviewListOrder
  }): Promise<ReviewRequest[]> {
    const wanted = filter?.status
    // A filter naming no status matches nothing, and `IN ()` parses on neither
    // engine, so that answer is given without a statement.
    if (wanted !== undefined && wanted.length === 0) return []
    const where = wanted === undefined ? '' : ` AND status IN (${placeholders(wanted.length)})`
    // Both terms move together, so the read stays total either way: an id
    // tie-break running against the timestamp would reorder rows sharing a
    // millisecond between two reads.
    const direction = filter?.order === 'oldest' ? 'ASC' : 'DESC'
    // The cap is pushed into SQL, not applied to what came back: with
    // `review_requests_created_idx` the engine walks that end of the index and
    // stops, where a read of everything decodes a payload per row the caller
    // drops.
    const cap = filter?.limit === undefined ? '' : ' LIMIT ?'
    const rows = await this.db.all(
      `SELECT data FROM review_requests WHERE org_id = ?${where} ORDER BY created_at ${direction}, id ${direction}${cap}`,
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

  async getByPullRequest(ref: PullRequestAddress): Promise<ReviewRequest | null> {
    const row = await this.db.first(
      'SELECT data FROM review_requests WHERE org_id = ? AND pull_request_key = ?',
      [this.orgId, pullRequestKey(ref)],
    )
    return row === null ? null : decodeData(reviewRequestSchema, 'review_requests', row.data)
  }

  async listByPullRequests(refs: readonly PullRequestAddress[]): Promise<ReviewRequest[]> {
    const keys = [...new Set(refs.map(pullRequestKey))]
    const found: ReviewRequest[] = []
    for (let start = 0; start < keys.length; start += KEYS_PER_READ) {
      const chunk = keys.slice(start, start + KEYS_PER_READ)
      const rows = await this.db.all(
        `SELECT data FROM review_requests WHERE org_id = ? AND pull_request_key IN (${placeholders(chunk.length)})`,
        [this.orgId, ...chunk],
      )
      found.push(...decodeRows(reviewRequestSchema, 'review_requests', rows))
    }
    return found
  }

  async listForRepository(
    repository: ProjectRef,
    filter: { status: readonly ReviewStatus[]; since: EpochMs; limit: number },
  ): Promise<ReviewRequest[]> {
    if (filter.status.length === 0) return []
    const rows = await this.db.all(
      `SELECT data FROM review_requests
WHERE org_id = ? AND repo_key = ? AND created_at >= ?
  AND status IN (${placeholders(filter.status.length)})
ORDER BY created_at DESC, id DESC LIMIT ?`,
      [this.orgId, projectRefKey(repository), filter.since, ...filter.status, filter.limit],
    )
    return decodeRows(reviewRequestSchema, 'review_requests', rows)
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
    await this.db.run(REVIEW_UPSERT, [
      this.orgId,
      review.id,
      review.status,
      pullRequestKey(review.pullRequest),
      projectRefKey(review.pullRequest),
      review.createdAt,
      encodeData(review),
    ])
  }
}

const REMINDER_UPSERT = `INSERT INTO reminders (org_id, id, review_id, status, due_at, claimed_at, data)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (org_id, id) DO UPDATE SET
  review_id = excluded.review_id,
  status = excluded.status,
  due_at = excluded.due_at,
  claimed_at = excluded.claimed_at,
  data = excluded.data`

function reminderParams(orgId: string, reminder: Reminder): readonly SqlParam[] {
  return [
    orgId,
    reminder.id,
    reminder.reviewId,
    reminder.status,
    reminder.dueAt,
    reminder.claimedAt,
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
  async claim(reminder: Reminder, claimedAt: EpochMs): Promise<boolean> {
    const claimed: Reminder = { ...reminder, status: 'sending', claimedAt }
    const row = await this.db.first(
      `UPDATE reminders SET status = ?, claimed_at = ?, data = ?
WHERE org_id = ? AND id = ? AND status = 'scheduled'
RETURNING id`,
      [claimed.status, claimedAt, encodeData(claimed), this.orgId, reminder.id],
    )
    return row !== null
  }

  /**
   * The claims nobody finished, oldest first.
   *
   * `claimed_at < ?` drops a null for free, which is what a row written before
   * the column existed carries: a claim with no timestamp cannot be aged, and a
   * sweep that guessed would give up on a send still in progress. The read is
   * covered by `reminders_claimed_idx`, and in the ordinary case `status =
   * 'sending'` is a handful of rows or none at all.
   */
  async listStalledClaims(claimedBefore: EpochMs, limit: number): Promise<Reminder[]> {
    const rows = await this.db.all(
      `SELECT data FROM reminders
WHERE org_id = ? AND status = 'sending' AND claimed_at < ?
ORDER BY claimed_at, id LIMIT ?`,
      [this.orgId, claimedBefore, limit],
    )
    return decodeRows(reminderSchema, 'reminders', rows)
  }

  /**
   * ONE conditional statement, exactly as `claim` is: `AND status = 'sending'`
   * is what makes sure only one pass over a stranded row goes on to re-plan its
   * review's ladder. `claimed_at` is deliberately left where it is — a failure
   * whose claim is minutes older than nothing at all is the record of what
   * happened.
   */
  async abandonClaim(reminder: Reminder, failureReason: string): Promise<boolean> {
    const abandoned: Reminder = { ...reminder, status: 'failed', failureReason }
    const row = await this.db.first(
      `UPDATE reminders SET status = ?, data = ?
WHERE org_id = ? AND id = ? AND status = 'sending'
RETURNING id`,
      [abandoned.status, encodeData(abandoned), this.orgId, reminder.id],
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
