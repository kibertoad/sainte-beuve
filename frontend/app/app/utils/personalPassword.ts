import { PERSONAL_PASSWORD_HEADER, personalPasswordContracts } from '@sainte-beuve/contracts'
import type { ApiContract } from '@toad-contracts/core'
import type { Wretch } from 'wretch'

/**
 * The cat-factory personal password, cached in this browser the way cat-factory's
 * own app caches it: so a person running reviews on their subscription is not
 * asked on every one. It is sent only as a header on the calls that file or
 * answer a review (`personalPasswordContracts`), and the server stores it nowhere.
 */

/** How long a typed password is kept, as cat-factory keeps it. */
export const PERSONAL_PASSWORD_TTL_MS = 40 * 60 * 60 * 1000

/**
 * A password with less than this left is no longer sent, so the prompt comes
 * before a run would outlive it (cat-factory keeps a run's unsealed credential
 * for twelve hours).
 */
export const PERSONAL_PASSWORD_EXPIRY_BUFFER_MS = 8 * 60 * 60 * 1000

/** FNV-1a, so the key names the backend without spelling its URL out in storage. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16)
}

/** One cache entry per backend and person, so two of either never share a password. */
export function personalPasswordCacheKey(apiBase: string, viewerId: string | null): string {
  return `sb.cf-personal-pw:${fnv1a(apiBase)}:${viewerId ?? 'anon'}`
}

interface Cached {
  password: string
  expiresAt: number
}

/** The cached password while it has more than the buffer left, else null. */
export function readCachedPassword(storage: Storage, key: string, now: number): string | null {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const cached = JSON.parse(raw) as Partial<Cached>
    if (typeof cached.password !== 'string' || typeof cached.expiresAt !== 'number') return null
    return cached.expiresAt - now > PERSONAL_PASSWORD_EXPIRY_BUFFER_MS ? cached.password : null
  } catch {
    return null
  }
}

export function cachePassword(storage: Storage, key: string, password: string, now: number): void {
  const entry: Cached = { password, expiresAt: now + PERSONAL_PASSWORD_TTL_MS }
  try {
    storage.setItem(key, JSON.stringify(entry))
  } catch {
    // A browser refusing storage asks again next time, which is the only cost.
  }
}

export function forgetCachedPassword(storage: Storage, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // Nothing was kept, then.
  }
}

/**
 * Who the cached password belongs to, set by the shell once it knows who is
 * signed in. Module state, because the client reads the password on every send,
 * outside any component.
 */
let actingViewer: string | null = null

export function setPersonalPasswordViewer(viewerId: string | null): void {
  actingViewer = viewerId
}

/** Local storage, or null in a browser that refuses it. */
function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** The password this browser holds for the person acting on `apiBase`, else null. */
export function currentPersonalPassword(apiBase: string): string | null {
  const storage = browserStorage()
  if (storage === null) return null
  return readCachedPassword(storage, personalPasswordCacheKey(apiBase, actingViewer), Date.now())
}

export function rememberPersonalPassword(apiBase: string, password: string): void {
  const storage = browserStorage()
  if (storage !== null) {
    cachePassword(storage, personalPasswordCacheKey(apiBase, actingViewer), password, Date.now())
  }
}

export function forgetPersonalPassword(apiBase: string): void {
  const storage = browserStorage()
  if (storage !== null)
    forgetCachedPassword(storage, personalPasswordCacheKey(apiBase, actingViewer))
}

/** The client for one call: carrying the cached password on the routes that take it. */
export function withPersonalPassword(
  client: Wretch,
  contract: ApiContract,
  password: (() => string | null) | undefined,
): Wretch {
  if (!personalPasswordContracts.has(contract)) return client
  const value = password?.() ?? null
  return value === null ? client : client.headers({ [PERSONAL_PASSWORD_HEADER]: value })
}
