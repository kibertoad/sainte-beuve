import type { IdentityProvider, Role } from '@sainte-beuve/contracts'
import type { EpochMs } from '../domain/types.js'

/**
 * A session, as it sits in the store: the same fields the contract carries, plus
 * the one that must never be on the wire.
 *
 * A kernel type rather than the contract object in a payload column, for the
 * reason the integration tokens are one: the row is flat, every field is queried
 * or shown, and the digest has to stay OUT of what a route can answer with. A
 * payload that held it would be one careless `c.json(session)` away from handing
 * a caller the means to present somebody else's session.
 */
export interface StoredSession {
  id: string
  /**
   * The digest of the token that presents this session, NOT the token. A session
   * value is 256 bits of randomness, so an unkeyed digest is enough to make the
   * stored row useless to whoever reads the database: there is nothing to guess
   * and no dictionary to run. Keying it would tie every live session to the
   * deployment's encryption key and sign everybody out on a rotation, for no
   * gain over a value that cannot be searched for in the first place.
   */
  tokenDigest: string
  /**
   * The tenancy this session is in, decided when it was established and never
   * afterwards. It is what `PersistenceProvider.forOrg` is handed on every
   * request the cookie arrives on, so a session cannot be carried across the
   * boundary by anything the caller sends.
   */
  orgId: string
  /** The person, as `@sainte-beuve/contracts` means it: a reviewer row. */
  reviewerId: string
  /** The host account they proved, keyed the way an identity always is. */
  provider: IdentityProvider
  subject: string
  createdAt: EpochMs
  lastSeenAt: EpochMs
  expiresAt: EpochMs
}

/**
 * The sessions a browser is carried by, within one org.
 *
 * The read on every authenticated request is NOT here: resolving a digest is
 * what decides which org the request is in, so it cannot be asked of a store
 * already bound to one. It lives on `TenancyDirectory` instead, and what is left
 * here is everything a request does once it knows where it is.
 */
export interface SessionRepository {
  create(session: StoredSession): Promise<StoredSession>
  /** Move `lastSeenAt` without rewriting the row. A no-op for a session that is gone. */
  touch(sessionId: string, lastSeenAt: EpochMs): Promise<void>
  delete(sessionId: string): Promise<void>
  /**
   * Drop every session of one person. What a directory change needs: pausing
   * somebody, or a reviewer row being merged into another, must not leave a
   * cookie that still resolves to the old one.
   */
  deleteForReviewer(reviewerId: string): Promise<void>
  /**
   * Drop everything already expired, and say how many went. Called by the
   * reminder tick, because a store nothing sweeps grows one row per sign-in for
   * ever and the expired ones are refused on read anyway.
   */
  deleteExpired(now: EpochMs): Promise<number>
}

/**
 * A key a machine calls with, as it sits in the store. Beside the digest that
 * matches it, for the same reason a session's is: the value itself exists once.
 */
export interface StoredApiKey {
  id: string
  tokenDigest: string
  /** The tenancy the key was minted in. Fixed at mint time, like a session's. */
  orgId: string
  label: string
  /** What the key may do in that org. See `roleSchema`. */
  role: Role
  /** The last four characters, so a row can be matched to an entry in a secret store. */
  hint: string
  /** The reviewer who minted it, when a person did. Null for one nobody is behind. */
  createdBy: string | null
  createdAt: EpochMs
  lastUsedAt: EpochMs | null
}

export interface ApiKeyRepository {
  /** Newest first, which is the order a directory of credentials is read in. */
  list(): Promise<StoredApiKey[]>
  create(key: StoredApiKey): Promise<StoredApiKey>
  touch(keyId: string, lastUsedAt: EpochMs): Promise<void>
  delete(keyId: string): Promise<void>
}
