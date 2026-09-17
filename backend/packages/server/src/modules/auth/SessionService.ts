import type { IdentityProvider, Session } from '@sainte-beuve/contracts'
import type { StoredSession } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { digestOf, mintToken, SESSION_TOKEN_PREFIX } from '../../crypto/tokens.js'

/**
 * The sessions a browser is carried by.
 *
 * A session is a random value in an `HttpOnly` cookie and a row keyed on its
 * digest. There is no JWT and no signed cookie, and that is the decision worth
 * recording: a self-describing token cannot be revoked, and the two things this
 * has to be able to do — sign somebody out, and drop every session of a reviewer
 * who was paused or merged away — are both revocations. A store lookup per
 * request is the price, and it is one indexed read against a store the request
 * was going to touch anyway.
 *
 * What the session does NOT carry is authority beyond identity. It says which
 * person is calling; what they may do is the org boundary, which is the half of
 * slice 6 still outstanding (docs/implementation-plan.md).
 */

/**
 * How stale `lastSeenAt` is allowed to get before a read writes.
 *
 * Without it every authenticated request is a WRITE, which on D1 is a billed
 * row-write per page load and on Postgres is a row lock on the session a burst
 * of parallel requests all hold. The field is for an operator looking at a
 * directory of sessions, so five minutes of imprecision costs nothing it is
 * read for.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

/** The account a session is established for, as the sign-in flow learned it. */
export interface SessionSubject {
  reviewerId: string
  provider: IdentityProvider
  subject: string
}

export class SessionService {
  constructor(private readonly container: AppContainer) {}

  /**
   * A new session, and the value that presents it. The token is returned and
   * never stored: what goes into the store is its digest, so this is the only
   * moment the value exists anywhere but the browser.
   */
  async issue(who: SessionSubject): Promise<{ token: string; session: StoredSession }> {
    const { clock, ids, repositories, auth } = this.container
    const token = mintToken(SESSION_TOKEN_PREFIX)
    const now = clock.now()
    const session = await repositories.sessions.create({
      id: ids.next(),
      tokenDigest: await digestOf(token),
      reviewerId: who.reviewerId,
      provider: who.provider,
      subject: who.subject,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + auth.sessionLifetimeMs,
    })
    return { token, session }
  }

  /**
   * The session behind a presented value, or null for anything else.
   *
   * Fails CLOSED at every step, like the state signer does: a cookie left over
   * from a previous deployment, a truncated value, and one whose row expired
   * while the tab was open all mean "nobody", not an error. An expired row is
   * DELETED on the way past rather than left for the sweep, so the one caller
   * who would notice it is the one who cleans it up.
   */
  async resolve(token: string | null): Promise<StoredSession | null> {
    if (token === null || !token.startsWith(SESSION_TOKEN_PREFIX)) return null
    const { sessions } = this.container.repositories
    const held = await sessions.findByDigest(await digestOf(token))
    if (held === null) return null
    const now = this.container.clock.now()
    if (held.expiresAt <= now) {
      await sessions.delete(held.id)
      return null
    }
    if (now - held.lastSeenAt < TOUCH_INTERVAL_MS) return held
    await sessions.touch(held.id, now)
    return { ...held, lastSeenAt: now }
  }

  async revoke(sessionId: string): Promise<void> {
    await this.container.repositories.sessions.delete(sessionId)
  }

  /** Every session of one person, for a directory change that must not leave one behind. */
  async revokeForReviewer(reviewerId: string): Promise<void> {
    await this.container.repositories.sessions.deleteForReviewer(reviewerId)
  }

  /** Drop what has already expired. Driven by the reminder tick; see `reminders/tick.ts`. */
  async sweepExpired(): Promise<number> {
    return this.container.repositories.sessions.deleteExpired(this.container.clock.now())
  }
}

/**
 * The stored row as its holder may see it: everything but the digest.
 *
 * Spelled out field by field rather than destructured away, so a field added to
 * `StoredSession` is absent here until somebody decides it belongs on the wire.
 * A rest-spread would publish it by default, and the next field of that kind is
 * as likely to be a secret as this one was.
 */
export function sessionOnTheWire(session: StoredSession): Session {
  return {
    id: session.id,
    provider: session.provider,
    subject: session.subject,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
  }
}
