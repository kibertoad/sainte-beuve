import type { IdentityProvider, Role } from '@sainte-beuve/contracts'
import { index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { epochMs, orgId } from './columns.js'

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
