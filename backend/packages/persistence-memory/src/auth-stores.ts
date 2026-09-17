import type {
  ApiKeyRepository,
  EpochMs,
  SessionRepository,
  StoredApiKey,
  StoredSession,
} from '@sainte-beuve/kernel'
import { clone } from './clone.js'
import { newestFirst } from './order.js'

/**
 * The authentication half of the in-memory store: the sessions a browser is
 * carried by and the keys a machine calls with.
 *
 * Both are keyed by id and READ by digest, which is a second index in a durable
 * store and a scan here. That asymmetry is fine at this size and is exactly the
 * kind of thing the conformance suite pins: what has to be identical across the
 * three stores is the behaviour (a digest resolves to one row, an expired
 * session is still returned and the caller decides), not how the row is found.
 */

export class InMemorySessionRepository implements SessionRepository {
  private readonly rows = new Map<string, StoredSession>()

  async findByDigest(tokenDigest: string): Promise<StoredSession | null> {
    for (const row of this.rows.values()) {
      if (row.tokenDigest === tokenDigest) return clone(row)
    }
    return null
  }

  async create(session: StoredSession): Promise<StoredSession> {
    this.rows.set(session.id, clone(session))
    return clone(session)
  }

  /**
   * A no-op for a session that is gone, rather than a throw. The row can be
   * swept between the read that resolved it and the write that records it was
   * used, and a request must not fail for having been slightly slow.
   */
  async touch(sessionId: string, lastSeenAt: EpochMs): Promise<void> {
    const row = this.rows.get(sessionId)
    if (row === undefined) return
    this.rows.set(sessionId, { ...row, lastSeenAt })
  }

  async delete(sessionId: string): Promise<void> {
    this.rows.delete(sessionId)
  }

  async deleteForReviewer(reviewerId: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.reviewerId === reviewerId) this.rows.delete(id)
    }
  }

  async deleteExpired(now: EpochMs): Promise<number> {
    let removed = 0
    for (const [id, row] of this.rows) {
      // `<=`, matching the read: a session whose expiry is exactly now is over,
      // and a store that swept on `<` would keep a row `resolve` refuses.
      if (row.expiresAt <= now) {
        this.rows.delete(id)
        removed += 1
      }
    }
    return removed
  }
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  private readonly rows = new Map<string, StoredApiKey>()

  async list(): Promise<StoredApiKey[]> {
    return [...this.rows.values()].sort(newestFirst((row) => row.createdAt)).map(clone)
  }

  async findByDigest(tokenDigest: string): Promise<StoredApiKey | null> {
    for (const row of this.rows.values()) {
      if (row.tokenDigest === tokenDigest) return clone(row)
    }
    return null
  }

  async create(key: StoredApiKey): Promise<StoredApiKey> {
    this.rows.set(key.id, clone(key))
    return clone(key)
  }

  async touch(keyId: string, lastUsedAt: EpochMs): Promise<void> {
    const row = this.rows.get(keyId)
    if (row === undefined) return
    this.rows.set(keyId, { ...row, lastUsedAt })
  }

  async delete(keyId: string): Promise<void> {
    this.rows.delete(keyId)
  }
}
