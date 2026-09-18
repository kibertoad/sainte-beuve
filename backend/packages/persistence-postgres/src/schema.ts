import type {
  AiReviewRun,
  AttentionRequest,
  IdentityProvider,
  LinkedIdentity,
  Org,
  Project,
  Reminder,
  Reviewer,
  ReviewCommitment,
  ReviewRequest,
  Role,
} from '@sainte-beuve/contracts'
import {
  aiReviewRunSchema,
  attentionRequestSchema,
  linkedIdentitySchema,
  orgSchema,
  projectSchema,
  reminderSchema,
  reviewCommitmentSchema,
  reviewerSchema,
  reviewRequestSchema,
} from '@sainte-beuve/contracts'
import { index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { epochMs, orgId, payload } from './columns.js'

/**
 * The board and the workspace, in Postgres types.
 *
 * EVERY TABLE BUT `orgs` IS KEYED ON `(org_id, ...)`. The tenancy is in the
 * primary key rather than beside it, because a tenancy a query can omit is a
 * tenancy a query will omit; with it in the key, a statement that forgot the org
 * cannot quietly read another one's rows.
 *
 * The same twelve tables and the same columns the D1 adapter carries
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
 * The payload is not an opaque blob at either end. The compiler knows its shape
 * through the `payload` column type below, so a write from a stale contract does
 * not typecheck, and that same column type parses what comes BACK through the
 * contract's schema, so a row already on disk in an older shape is healed or named
 * rather than believed.
 *
 * Timestamps are epoch milliseconds, in `mode: 'number'` so they arrive as
 * numbers. A bare `bigint` comes back from node-postgres as a STRING (its range
 * does not fit a JS number), and a `createdAt` that is sometimes a string is a
 * sort that is sometimes lexicographic.
 */

/**
 * The tenancies. The one table with no `org_id`, because it is the table that
 * says which orgs there are. The slug is UNIQUE: it is what a sign-in names, and
 * two orgs answering to one name would make which board somebody lands on depend
 * on which row the planner reached first.
 */
export const orgs = pgTable('orgs', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique('orgs_slug_idx'),
  createdAt: epochMs('created_at').notNull(),
  data: payload<Org>('data', 'orgs', orgSchema).notNull(),
})

export const reviewers = pgTable(
  'reviewers',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    /**
     * NOT derived from `data`. `adjustOutstanding` increments rather than writes,
     * so two assignments landing together must both count; the column is
     * authoritative and every read overlays it onto the decoded payload.
     */
    outstandingReviews: integer('outstanding_reviews').notNull().default(0),
    createdAt: epochMs('created_at').notNull(),
    data: payload<Reviewer>('data', 'reviewers', reviewerSchema).notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.id] })],
)

export const reviewRequests = pgTable(
  'review_requests',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    status: text('status').notNull(),
    prOwner: text('pr_owner').notNull(),
    prRepo: text('pr_repo').notNull(),
    prNumber: integer('pr_number').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: payload<ReviewRequest>('data', 'review_requests', reviewRequestSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    // Both board reads, and the ORDER is part of each. The list is answered
    // newest first with the id as the tie-break and a `LIMIT` on top, so an
    // index that stopped at `created_at` would still leave the engine sorting
    // for the tie and an ascending one would be scanned backwards from the far
    // end of the org's history.
    index('review_requests_status_idx').on(
      table.orgId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    // The same read with no status named, which is the unfiltered board: served
    // by nothing before this, because a composite that starts with the status
    // cannot answer a query that does not mention one.
    index('review_requests_created_idx').on(table.orgId, table.createdAt.desc(), table.id.desc()),
    // A webhook replay looks a review up by the pull request it is about, so
    // this is the index that keeps an intake from scanning the board.
    index('review_requests_pr_idx').on(table.orgId, table.prOwner, table.prRepo, table.prNumber),
  ],
)

export const reminders = pgTable(
  'reminders',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    reviewId: text('review_id').notNull(),
    status: text('status').notNull(),
    dueAt: epochMs('due_at').notNull(),
    /**
     * Nullable: only a nudge a sender has TAKEN has a claim, and a row written
     * before this column existed has none. See `Reminder.claimedAt`.
     */
    claimedAt: epochMs('claimed_at'),
    data: payload<Reminder>('data', 'reminders', reminderSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    index('reminders_review_idx').on(table.orgId, table.reviewId),
    // The reminder tick's due read: what is scheduled and already due, in the
    // org it is ticking. The tick walks the orgs, so this index is per tenancy.
    index('reminders_due_idx').on(table.orgId, table.status, table.dueAt),
    // The tick's other read: the claims nobody finished. Same shape, different
    // timestamp — `status = 'sending'` is a handful of rows in the ordinary
    // case, and this is what keeps it that way when it is not.
    index('reminders_claimed_idx').on(table.orgId, table.status, table.claimedAt),
  ],
)

export const aiReviewRuns = pgTable(
  'ai_review_runs',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    reviewId: text('review_id').notNull(),
    status: text('status').notNull(),
    requestedAt: epochMs('requested_at').notNull(),
    /** Nullable: a run nobody has polled yet has no reading, and sorts first. */
    lastPolledAt: epochMs('last_polled_at'),
    data: payload<AiReviewRun>('data', 'ai_review_runs', aiReviewRunSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    index('ai_review_runs_review_idx').on(table.orgId, table.reviewId, table.requestedAt),
    // The reminder tick's AI-review read: what is unsettled in the org it is
    // ticking, least recently polled first. cat-factory calls nothing back, so
    // this is what the clock polls instead of waiting for somebody to open the
    // row, and the rotation is what stops a batch's worth of parked reviews
    // holding the cap for ever. See `AiReviewRunRepository.listInFlight`.
    // `NULLS FIRST` on the index and not only in the query: Postgres stores an
    // ascending key nulls-LAST, so an index that disagreed with the order the
    // read asks for would be scanned and then sorted, which is the scan this
    // column exists to avoid.
    index('ai_review_runs_status_idx').on(
      table.orgId,
      table.status,
      table.lastPolledAt.asc().nullsFirst(),
    ),
  ],
)

/**
 * The sealed integration credentials: the one table with no payload column,
 * because the row is four flat fields and all of them are read.
 *
 * What is stored is an ENVELOPE. The plaintext never reaches a repository, so a
 * dump of this table carries no usable credential.
 */
export const integrationTokens = pgTable(
  'integration_tokens',
  {
    orgId: orgId(),
    integrationId: text('integration_id').notNull(),
    sealed: text('sealed').notNull(),
    hint: text('hint').notNull(),
    /** Null for a credential somebody pasted, because a pasted token names nobody. */
    subject: text('subject'),
    updatedAt: epochMs('updated_at').notNull(),
  },
  // Per ORG: each tenancy connects its own GitHub and its own Slack, and a
  // credential shared across the boundary would let one org's board write
  // comments as another org's bot.
  (table) => [primaryKey({ columns: [table.orgId, table.integrationId] })],
)

export const projects = pgTable(
  'projects',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    /** `provider:owner/repo`, lowercased. */
    refKey: text('ref_key').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: payload<Project>('data', 'projects', projectSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    // UNIQUE PER ORG rather than globally: the port declares a repository is
    // registered once inside a tenancy, and two tenancies watching one
    // repository is the ordinary multi-tenant case rather than a duplicate.
    uniqueIndex('projects_ref_idx').on(table.orgId, table.refKey),
    // The one read an inbound webhook makes before it knows where it is: which
    // org registered this repository. See `TenancyDirectory`.
    index('projects_tenancy_idx').on(table.refKey, table.createdAt),
  ],
)

/**
 * An identity is `(provider, subject)` and never a handle: a login is
 * renameable and reusable by whoever claims it next. The primary key is what
 * makes the first claim win.
 *
 * The ORG is part of it, so the same GitHub account is a person in each tenancy
 * that knows them. One row across all of them would make signing in to a second
 * org hand back the first org's reviewer.
 */
export const identities = pgTable(
  'identities',
  {
    orgId: orgId(),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    data: payload<LinkedIdentity>('data', 'identities', linkedIdentitySchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.provider, table.subject] }),
    index('identities_reviewer_idx').on(table.orgId, table.reviewerId),
  ],
)

export const attentionRequests = pgTable(
  'attention_requests',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    status: text('status').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: payload<AttentionRequest>('data', 'attention_requests', attentionRequestSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    index('attention_requests_status_idx').on(table.orgId, table.status, table.createdAt),
  ],
)

export const reviewCommitments = pgTable(
  'review_commitments',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    /**
     * `provider:owner/repo#number`. The host is part of the key: the same path
     * and number exist on both, and they are two different changes.
     */
    pullRequestKey: text('pull_request_key').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: payload<ReviewCommitment>('data', 'review_commitments', reviewCommitmentSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    index('review_commitments_reviewer_idx').on(table.orgId, table.reviewerId, table.createdAt),
  ],
)

/**
 * The sessions a browser is carried by.
 *
 * No payload column, beside `integration_tokens` and for the same reason: the
 * row is flat and every field is read. What is stored of the credential is a
 * DIGEST, so a dump of this table lets nobody present anything.
 */
export const sessions = pgTable(
  'sessions',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    /**
     * SHA-256 of the cookie's value, base64url. UNIQUE ACROSS EVERY ORG, unlike
     * every other index here: the digest is what DECIDES which org a request is
     * in, so it is read before there is an org to scope it by, and two rows for
     * one value would make which board a cookie opens depend on which row the
     * planner reached first.
     */
    tokenDigest: text('token_digest').notNull().unique('sessions_digest_idx'),
    reviewerId: text('reviewer_id').notNull(),
    provider: text('provider').$type<IdentityProvider>().notNull(),
    subject: text('subject').notNull(),
    createdAt: epochMs('created_at').notNull(),
    lastSeenAt: epochMs('last_seen_at').notNull(),
    expiresAt: epochMs('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    index('sessions_reviewer_idx').on(table.orgId, table.reviewerId),
    // The tick's sweep: everything already expired, in the org it is ticking.
    index('sessions_expiry_idx').on(table.orgId, table.expiresAt),
  ],
)

/** The keys a machine calls with. Beside the sessions, and stored the same way. */
export const apiKeys = pgTable(
  'api_keys',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    /** Global, beside the sessions' digest and for the same reason. */
    tokenDigest: text('token_digest').notNull().unique('api_keys_digest_idx'),
    label: text('label').notNull(),
    /**
     * What the key may do in its org. On the ROW rather than derived from
     * whoever minted it: a key outlives the person who made it, and a CI job
     * that silently inherited an operator's admin is how a build script comes to
     * be able to revoke the credentials it runs on.
     */
    role: text('role').$type<Role>().notNull().default('member'),
    /** The last four characters, so a row can be matched to a secret store's entry. */
    hint: text('hint').notNull(),
    /** The reviewer who minted it, when a person did. Null for one nobody is behind. */
    createdBy: text('created_by'),
    createdAt: epochMs('created_at').notNull(),
    lastUsedAt: epochMs('last_used_at'),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    index('api_keys_created_idx').on(table.orgId, table.createdAt),
  ],
)
