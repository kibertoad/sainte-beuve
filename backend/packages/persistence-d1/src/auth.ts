import type { IdentityProvider, Role } from '@sainte-beuve/contracts'
import type {
  ApiKeyRepository,
  EpochMs,
  SessionRepository,
  StoredApiKey,
  StoredSession,
} from '@sainte-beuve/kernel'
import type { SqlDriver, SqlRow } from './driver.js'
import { decodeCount } from './rows.js'

/**
 * Sessions and API keys, on D1.
 *
 * The two tables with no payload column, beside `integration_tokens` and for the
 * same reason: the row is flat, every field is read, and wrapping it in JSON
 * would hide the label and the hint a Configuration screen shows from anybody
 * looking at the database. What is stored of the credential is a DIGEST, so a
 * dump of either table is worth nothing.
 *
 * Both rows carry an `org_id`, and both tables are read TWICE with different
 * scoping. Everything a request does once it knows where it is goes through the
 * org-bound repositories below; resolving a digest is what DECIDES where it is,
 * so it happens across the whole table and is not a method these classes carry.
 * That read lives on `D1TenancyDirectory` in `provider.ts`, which is the only
 * place in this package that queries without an org.
 */

const SESSION_COLUMNS =
  'id, org_id, token_digest, reviewer_id, provider, subject, created_at, last_seen_at, expires_at'

export function toSession(row: SqlRow): StoredSession {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    tokenDigest: String(row.token_digest),
    reviewerId: String(row.reviewer_id),
    // The column is the picklist's own text, written from a typed value; a row
    // holding anything else was written by hand, and the cast says what this
    // store believes rather than checking what it cannot repair.
    provider: String(row.provider) as IdentityProvider,
    subject: String(row.subject),
    createdAt: decodeCount(row.created_at),
    lastSeenAt: decodeCount(row.last_seen_at),
    expiresAt: decodeCount(row.expires_at),
  }
}

export const SESSION_BY_DIGEST = `SELECT ${SESSION_COLUMNS} FROM sessions WHERE token_digest = ?`

export class SqlSessionRepository implements SessionRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async create(session: StoredSession): Promise<StoredSession> {
    await this.db.run(
      `INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        // From the ROW rather than from this store's binding: `issue` is the one
        // caller, it writes the org it was resolved for, and the two are the
        // same value. Taking it from the row keeps the insert readable beside
        // the column list rather than silently substituting a field.
        session.orgId,
        session.tokenDigest,
        session.reviewerId,
        session.provider,
        session.subject,
        session.createdAt,
        session.lastSeenAt,
        session.expiresAt,
      ],
    )
    return session
  }

  /** One column, so a request that is only recording it does not rewrite the row. */
  async touch(sessionId: string, lastSeenAt: EpochMs): Promise<void> {
    await this.db.run('UPDATE sessions SET last_seen_at = ? WHERE org_id = ? AND id = ?', [
      lastSeenAt,
      this.orgId,
      sessionId,
    ])
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE org_id = ? AND id = ?', [this.orgId, sessionId])
  }

  async deleteForReviewer(reviewerId: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE org_id = ? AND reviewer_id = ?', [
      this.orgId,
      reviewerId,
    ])
  }

  /**
   * Counted by reading first, because D1's `run` does not hand back a row count
   * through this driver's seam. Two statements for a sweep that runs once a
   * minute is the cheaper half of the trade against a fifth driver method every
   * other store would carry and none would call.
   */
  async deleteExpired(now: EpochMs): Promise<number> {
    const doomed = await this.db.all(
      'SELECT id FROM sessions WHERE org_id = ? AND expires_at <= ?',
      [this.orgId, now],
    )
    if (doomed.length === 0) return 0
    await this.db.run('DELETE FROM sessions WHERE org_id = ? AND expires_at <= ?', [
      this.orgId,
      now,
    ])
    return doomed.length
  }
}

const KEY_COLUMNS =
  'id, org_id, token_digest, label, role, hint, created_by, created_at, last_used_at'

export function toKey(row: SqlRow): StoredApiKey {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    tokenDigest: String(row.token_digest),
    label: String(row.label),
    // The column is the picklist's own text, cast for the reason a session's
    // provider is: this store says what it believes rather than repairing a row
    // somebody wrote by hand.
    role: String(row.role) as Role,
    hint: String(row.hint),
    createdBy: nullableText(row.created_by),
    createdAt: decodeCount(row.created_at),
    lastUsedAt: nullableCount(row.last_used_at),
  }
}

export const KEY_BY_DIGEST = `SELECT ${KEY_COLUMNS} FROM api_keys WHERE token_digest = ?`

/** SQLite and Postgres agree on NULL, and disagree about nothing else here. */
function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function nullableCount(value: unknown): number | null {
  return value === null || value === undefined ? null : decodeCount(value)
}

export class SqlApiKeyRepository implements ApiKeyRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list(): Promise<StoredApiKey[]> {
    const rows = await this.db.all(
      `SELECT ${KEY_COLUMNS} FROM api_keys WHERE org_id = ? ORDER BY created_at DESC, id DESC`,
      [this.orgId],
    )
    return rows.map(toKey)
  }

  async create(key: StoredApiKey): Promise<StoredApiKey> {
    await this.db.run(`INSERT INTO api_keys (${KEY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      key.id,
      key.orgId,
      key.tokenDigest,
      key.label,
      key.role,
      key.hint,
      key.createdBy,
      key.createdAt,
      key.lastUsedAt,
    ])
    return key
  }

  async touch(keyId: string, lastUsedAt: EpochMs): Promise<void> {
    await this.db.run('UPDATE api_keys SET last_used_at = ? WHERE org_id = ? AND id = ?', [
      lastUsedAt,
      this.orgId,
      keyId,
    ])
  }

  async delete(keyId: string): Promise<void> {
    await this.db.run('DELETE FROM api_keys WHERE org_id = ? AND id = ?', [this.orgId, keyId])
  }
}
