import type {
  ApiKeyRepository,
  EpochMs,
  SessionRepository,
  StoredApiKey,
  StoredSession,
} from '@sainte-beuve/kernel'
import type { IdentityProvider } from '@sainte-beuve/contracts'
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
 */

const SESSION_COLUMNS =
  'id, token_digest, reviewer_id, provider, subject, created_at, last_seen_at, expires_at'

function toSession(row: SqlRow): StoredSession {
  return {
    id: String(row.id),
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

export class SqlSessionRepository implements SessionRepository {
  constructor(private readonly db: SqlDriver) {}

  async findByDigest(tokenDigest: string): Promise<StoredSession | null> {
    const row = await this.db.first(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE token_digest = ?`,
      [tokenDigest],
    )
    return row === null ? null : toSession(row)
  }

  async create(session: StoredSession): Promise<StoredSession> {
    await this.db.run(`INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      session.id,
      session.tokenDigest,
      session.reviewerId,
      session.provider,
      session.subject,
      session.createdAt,
      session.lastSeenAt,
      session.expiresAt,
    ])
    return session
  }

  /** One column, so a request that is only recording it does not rewrite the row. */
  async touch(sessionId: string, lastSeenAt: EpochMs): Promise<void> {
    await this.db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [lastSeenAt, sessionId])
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE id = ?', [sessionId])
  }

  async deleteForReviewer(reviewerId: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE reviewer_id = ?', [reviewerId])
  }

  /**
   * Counted by reading first, because D1's `run` does not hand back a row count
   * through this driver's seam. Two statements for a sweep that runs once a
   * minute is the cheaper half of the trade against a fifth driver method every
   * other store would carry and none would call.
   */
  async deleteExpired(now: EpochMs): Promise<number> {
    const doomed = await this.db.all('SELECT id FROM sessions WHERE expires_at <= ?', [now])
    if (doomed.length === 0) return 0
    await this.db.run('DELETE FROM sessions WHERE expires_at <= ?', [now])
    return doomed.length
  }
}

const KEY_COLUMNS = 'id, token_digest, label, hint, created_by, created_at, last_used_at'

function toKey(row: SqlRow): StoredApiKey {
  return {
    id: String(row.id),
    tokenDigest: String(row.token_digest),
    label: String(row.label),
    hint: String(row.hint),
    createdBy: nullableText(row.created_by),
    createdAt: decodeCount(row.created_at),
    lastUsedAt: nullableCount(row.last_used_at),
  }
}

/** SQLite and Postgres agree on NULL, and disagree about nothing else here. */
function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function nullableCount(value: unknown): number | null {
  return value === null || value === undefined ? null : decodeCount(value)
}

export class SqlApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: SqlDriver) {}

  async list(): Promise<StoredApiKey[]> {
    const rows = await this.db.all(
      `SELECT ${KEY_COLUMNS} FROM api_keys ORDER BY created_at DESC, id DESC`,
    )
    return rows.map(toKey)
  }

  async findByDigest(tokenDigest: string): Promise<StoredApiKey | null> {
    const row = await this.db.first(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE token_digest = ?`, [
      tokenDigest,
    ])
    return row === null ? null : toKey(row)
  }

  async create(key: StoredApiKey): Promise<StoredApiKey> {
    await this.db.run(`INSERT INTO api_keys (${KEY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      key.id,
      key.tokenDigest,
      key.label,
      key.hint,
      key.createdBy,
      key.createdAt,
      key.lastUsedAt,
    ])
    return key
  }

  async touch(keyId: string, lastUsedAt: EpochMs): Promise<void> {
    await this.db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [lastUsedAt, keyId])
  }

  async delete(keyId: string): Promise<void> {
    await this.db.run('DELETE FROM api_keys WHERE id = ?', [keyId])
  }
}
