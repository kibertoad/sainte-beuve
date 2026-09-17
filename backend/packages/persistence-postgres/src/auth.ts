import type {
  ApiKeyRepository,
  EpochMs,
  SessionRepository,
  StoredApiKey,
  StoredSession,
} from '@sainte-beuve/kernel'
import { desc, eq, lte } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr } from './rows.js'
import { apiKeys, sessions } from './schema.js'

/**
 * Sessions and API keys, in Postgres.
 *
 * The row IS the columns here, with no payload: every field is read, and the
 * one that matters is a DIGEST rather than the credential. A dump of either
 * table lets nobody present anything, which is what makes the durable store no
 * more sensitive than the in-memory one it replaces.
 */

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async findByDigest(tokenDigest: string): Promise<StoredSession | null> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.tokenDigest, tokenDigest))
    return firstOr(rows)
  }

  async create(session: StoredSession): Promise<StoredSession> {
    await this.db.insert(sessions).values(session)
    return session
  }

  /** One column, so a request that is only recording it does not rewrite the row. */
  async touch(sessionId: string, lastSeenAt: EpochMs): Promise<void> {
    await this.db.update(sessions).set({ lastSeenAt }).where(eq(sessions.id, sessionId))
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId))
  }

  async deleteForReviewer(reviewerId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.reviewerId, reviewerId))
  }

  /**
   * `RETURNING id`, so the count is the rows this statement actually removed
   * rather than what a separate read found a moment earlier. The D1 side counts
   * with a second statement because its driver seam has no row count; this one
   * does it in the delete, and the conformance suite holds both to the number.
   */
  async deleteExpired(now: EpochMs): Promise<number> {
    const removed = await this.db
      .delete(sessions)
      .where(lte(sessions.expiresAt, now))
      .returning({ id: sessions.id })
    return removed.length
  }
}

export class PostgresApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async list(): Promise<StoredApiKey[]> {
    return this.db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
  }

  async findByDigest(tokenDigest: string): Promise<StoredApiKey | null> {
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.tokenDigest, tokenDigest))
    return firstOr(rows)
  }

  async create(key: StoredApiKey): Promise<StoredApiKey> {
    await this.db.insert(apiKeys).values(key)
    return key
  }

  async touch(keyId: string, lastUsedAt: EpochMs): Promise<void> {
    await this.db.update(apiKeys).set({ lastUsedAt }).where(eq(apiKeys.id, keyId))
  }

  async delete(keyId: string): Promise<void> {
    await this.db.delete(apiKeys).where(eq(apiKeys.id, keyId))
  }
}
