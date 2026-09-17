import type { ApiKey } from '@sainte-beuve/contracts'
import { type StoredApiKey, timingSafeEqual, ValidationError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { API_KEY_PREFIX, digestOf, hintOfToken, mintToken } from '../../crypto/tokens.js'

/**
 * The keys a machine calls with.
 *
 * A key is NOT a person, and everything about this follows from that. It has no
 * reviewer row, so it has no workspace and no three lists; the routes that render
 * for a viewer refuse it by name (see `ViewerService`) rather than inventing a
 * person for it, which is the same answer a GitHub App installation gets and for
 * the same reason.
 *
 * Stored as a digest, like a session, so this table is worth nothing to whoever
 * reads the database. What is kept in readable form is a LABEL and the last four
 * characters, which is what an operator needs to decide whether the row in front
 * of them is the key in their CI secret store.
 */

/**
 * The id reported for the deployment's own key, which is not a row.
 *
 * It is a reserved value rather than a uuid: it has to be recognisable in a log
 * line, and it must never collide with a minted key's id. `ids.next()` is a
 * uuid on every facade, so nothing generated can be spelled this way.
 */
export const ENVIRONMENT_KEY_ID = 'environment'

/** Whoever is calling on a key, once one has been matched. */
export interface ApiKeyPrincipal {
  keyId: string
  label: string
}

export class ApiKeyService {
  constructor(private readonly container: AppContainer) {}

  async list(): Promise<ApiKey[]> {
    return (await this.container.repositories.apiKeys.list()).map(apiKeyOnTheWire)
  }

  /**
   * Mint one. The token is returned once and never stored, so a caller that
   * loses it mints another rather than recovering this one.
   */
  async mint(input: { label: string; createdBy: string | null }): Promise<{
    key: ApiKey
    token: string
  }> {
    const { clock, ids, repositories } = this.container
    const token = mintToken(API_KEY_PREFIX)
    const stored = await repositories.apiKeys.create({
      id: ids.next(),
      tokenDigest: await digestOf(token),
      label: input.label,
      hint: hintOfToken(token),
      createdBy: input.createdBy,
      createdAt: clock.now(),
      lastUsedAt: null,
    })
    return { key: apiKeyOnTheWire(stored), token }
  }

  /**
   * Revoke one.
   *
   * The deployment's own key is refused rather than 404'd: it is a real
   * credential that really works, and "no such key" would send an operator
   * looking for a row that was never there instead of at the variable that is.
   */
  async revoke(keyId: string): Promise<void> {
    if (keyId === ENVIRONMENT_KEY_ID) {
      throw new ValidationError(
        "This deployment's own API key comes from its environment, so it cannot be revoked here: " +
          'clear AUTH_API_KEY and restart.',
      )
    }
    await this.container.repositories.apiKeys.delete(keyId)
  }

  /**
   * Who a presented key is, or null.
   *
   * The environment's key is matched FIRST, and not by digest: it never went
   * through `mint`, and matching it before the store is what keeps a deployment
   * reachable while its database is being restored.
   *
   * It is also matched before the PREFIX, which is the order that matters. An
   * operator sets `AUTH_API_KEY` to whatever their secret manager generated, and
   * nothing anywhere asks them for `sbk_`; a prefix check in front of that
   * comparison turns the one credential that answers the bootstrap into a value
   * that is silently never a caller, on a deployment `/health` still reports as
   * having one. The prefix is a cheap way to skip a store read for a value that
   * cannot be a MINTED key, and it is only worth that much.
   */
  async verify(token: string | null): Promise<ApiKeyPrincipal | null> {
    if (token === null || token.length === 0) return null
    if (this.isEnvironmentKey(token)) {
      return { keyId: ENVIRONMENT_KEY_ID, label: ENVIRONMENT_KEY_ID }
    }
    if (!token.startsWith(API_KEY_PREFIX)) return null
    const { apiKeys } = this.container.repositories
    const held = await apiKeys.findByDigest(await digestOf(token))
    if (held === null) return null
    await this.touch(held)
    return { keyId: held.id, label: held.label }
  }

  /**
   * Constant-time, over bytes rather than strings. `===` on a secret leaks its
   * prefix through timing, and this one is the credential a deployment cannot
   * rotate without a restart.
   */
  private isEnvironmentKey(token: string): boolean {
    const configured = this.container.auth.environmentApiKey
    if (configured === null) return false
    const encoder = new TextEncoder()
    return timingSafeEqual(encoder.encode(configured), encoder.encode(token))
  }

  /**
   * Record that a key was used, at most once a day per key.
   *
   * `lastUsedAt` answers "is anything still using this?", which is a question
   * about days, and a machine credential is presented on every request a job
   * makes: writing per call would put a row-write in front of the read it is
   * decorating, for a field nobody reads at that resolution.
   */
  private async touch(key: StoredApiKey): Promise<void> {
    const now = this.container.clock.now()
    if (key.lastUsedAt !== null && now - key.lastUsedAt < TOUCH_INTERVAL_MS) return
    await this.container.repositories.apiKeys.touch(key.id, now)
  }
}

/** A day; see `touch`. */
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * The stored row as a directory may see it: everything but the digest. Spelled
 * out field by field for the reason `sessionOnTheWire` is.
 */
function apiKeyOnTheWire(key: StoredApiKey): ApiKey {
  return {
    id: key.id,
    label: key.label,
    hint: key.hint,
    createdBy: key.createdBy,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
  }
}
