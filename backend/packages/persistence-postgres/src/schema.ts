import type {
  AiReviewRun,
  AttentionRequest,
  LinkedIdentity,
  Project,
  Reminder,
  Reviewer,
  ReviewCommitment,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import { bigint, index, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'

/**
 * The board and the workspace, in Postgres types.
 *
 * The same nine tables and the same columns the D1 adapter carries
 * (`@sainte-beuve/persistence-d1/migrations`), so the two durable stores read
 * the same in a database console and a deployment can be described once. What
 * differs is only what the engines spell differently: `jsonb` where SQLite has
 * `TEXT`, and `bigint` where it has `INTEGER`.
 *
 * THE PAYLOAD IS THE ROW. `data` holds the contract object and the columns
 * beside it are indexes derived from it at write time: the status a filter
 * reads, the `due_at` the reminder tick scans, the `(owner, repo, number)` a
 * webhook replay looks a review up by. The ports are coarse on purpose
 * (`listDue`, not a query builder), so that list of indexes is short and
 * closed, and a column per contract field would be a mapper to keep in step
 * with contracts that still move every slice, plus a JSON column anyway for the
 * arrays and the nested objects.
 *
 * `$type` is where Drizzle earns its place here: the payload is not an opaque
 * blob to the compiler, so a row written from a stale contract shape does not
 * typecheck.
 *
 * Timestamps are epoch milliseconds, in `mode: 'number'` so they arrive as
 * numbers. A bare `bigint` comes back from node-postgres as a STRING (its range
 * does not fit a JS number), and a `createdAt` that is sometimes a string is a
 * sort that is sometimes lexicographic.
 */

/** Epoch milliseconds, as every contract carries them. */
function epochMs(name: string) {
  return bigint(name, { mode: 'number' })
}

export const reviewers = pgTable('reviewers', {
  id: text('id').primaryKey(),
  /**
   * NOT derived from `data`. `adjustOutstanding` increments rather than writes,
   * so two assignments landing together must both count; the column is
   * authoritative and every read overlays it onto the decoded payload.
   */
  outstandingReviews: integer('outstanding_reviews').notNull().default(0),
  createdAt: epochMs('created_at').notNull(),
  data: jsonb('data').$type<Reviewer>().notNull(),
})

export const reviewRequests = pgTable(
  'review_requests',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    prOwner: text('pr_owner').notNull(),
    prRepo: text('pr_repo').notNull(),
    prNumber: integer('pr_number').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: jsonb('data').$type<ReviewRequest>().notNull(),
  },
  (table) => [
    index('review_requests_status_idx').on(table.status, table.createdAt),
    // A webhook replay looks a review up by the pull request it is about, so
    // this is the index that keeps an intake from scanning the board.
    index('review_requests_pr_idx').on(table.prOwner, table.prRepo, table.prNumber),
  ],
)

export const reminders = pgTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id').notNull(),
    status: text('status').notNull(),
    dueAt: epochMs('due_at').notNull(),
    data: jsonb('data').$type<Reminder>().notNull(),
  },
  (table) => [
    index('reminders_review_idx').on(table.reviewId),
    // The reminder tick's only read: what is scheduled and already due.
    index('reminders_due_idx').on(table.status, table.dueAt),
  ],
)

export const aiReviewRuns = pgTable(
  'ai_review_runs',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id').notNull(),
    requestedAt: epochMs('requested_at').notNull(),
    data: jsonb('data').$type<AiReviewRun>().notNull(),
  },
  (table) => [index('ai_review_runs_review_idx').on(table.reviewId, table.requestedAt)],
)

/**
 * The sealed integration credentials: the one table with no payload column,
 * because the row is four flat fields and all of them are read.
 *
 * What is stored is an ENVELOPE. The plaintext never reaches a repository, so a
 * dump of this table carries no usable credential.
 */
export const integrationTokens = pgTable('integration_tokens', {
  integrationId: text('integration_id').primaryKey(),
  sealed: text('sealed').notNull(),
  hint: text('hint').notNull(),
  /** Null for a credential somebody pasted, because a pasted token names nobody. */
  subject: text('subject'),
  updatedAt: epochMs('updated_at').notNull(),
})

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  /**
   * `provider:owner/repo`, lowercased. UNIQUE, because the port declares a
   * repository is registered once and two rows for it would list one project
   * on the workspace twice.
   */
  refKey: text('ref_key').notNull().unique('projects_ref_idx'),
  createdAt: epochMs('created_at').notNull(),
  data: jsonb('data').$type<Project>().notNull(),
})

/**
 * An identity is `(provider, subject)` and never a handle: a login is
 * renameable and reusable by whoever claims it next. The primary key is what
 * makes the first claim win.
 */
export const identities = pgTable(
  'identities',
  {
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    data: jsonb('data').$type<LinkedIdentity>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.subject] }),
    index('identities_reviewer_idx').on(table.reviewerId),
  ],
)

export const attentionRequests = pgTable(
  'attention_requests',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: jsonb('data').$type<AttentionRequest>().notNull(),
  },
  (table) => [index('attention_requests_status_idx').on(table.status, table.createdAt)],
)

export const reviewCommitments = pgTable(
  'review_commitments',
  {
    id: text('id').primaryKey(),
    reviewerId: text('reviewer_id').notNull(),
    /**
     * `provider:owner/repo#number`. The host is part of the key: the same path
     * and number exist on both, and they are two different changes.
     */
    pullRequestKey: text('pull_request_key').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: jsonb('data').$type<ReviewCommitment>().notNull(),
  },
  (table) => [index('review_commitments_reviewer_idx').on(table.reviewerId, table.createdAt)],
)
