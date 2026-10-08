import type { EpochMs } from '@sainte-beuve/kernel'

/** The ceiling `CredentialThrottle` holds each client to. */
export interface ThrottleLimits {
  /** Failures one client may have in a window before it is refused. */
  maxFailures: number
  /** How long a window lasts, and so how long a refusal lasts at most. */
  windowMs: number
  /**
   * How many clients are remembered at once. A spray across addresses (an IPv6
   * block is a lot of them) must cost this process a bounded map, not memory.
   */
  maxClients: number
}

const DEFAULT_THROTTLE_LIMITS: ThrottleLimits = {
  maxFailures: 20,
  windowMs: 10 * 60 * 1000,
  maxClients: 10_000,
}

interface Window {
  startedAt: EpochMs
  failures: number
}

/** What `CredentialThrottle.attempt` made of one presented value. */
export type ThrottledAttempt<T> =
  | { kind: 'refused'; retryAfterSeconds: number }
  | { kind: 'compared'; match: T | null }

/**
 * How often one client may present a value for `AUTH_API_KEY` that is not it.
 *
 * Minted keys and sessions are 256-bit and nobody guesses one, so they are not
 * counted here. `AUTH_API_KEY` is whatever an operator typed, it is an ADMIN of
 * the default org, and without a ceiling the only thing between a weak one and
 * a stranger is how fast the stranger can send requests.
 * `environmentApiKeyFrom` refuses the short ones; this is the other half.
 *
 * WHAT IS COUNTED is a comparison against that key which failed, and nothing
 * else: not a request with no credential, not a session cookie that no longer
 * resolves, not a minted key (right or wrong), and not a bearer on a deployment
 * that holds no `AUTH_API_KEY`. So a browser or a CI job on a minted key keeps
 * working behind the same address as a guesser.
 *
 * WHERE IT LIVES is the app, not the container: one per Node process and one per
 * Worker isolate. That is a floor rather than a guarantee on a Worker, where a
 * guesser spread across isolates gets a ceiling per isolate, and a deployment
 * that wants a hard one sets a rate-limiting rule at the edge as well.
 *
 * Fixed windows rather than a sliding log: the question is "is this address
 * guessing", and a window answers it with one counter per address.
 */
export class CredentialThrottle {
  private readonly windows = new Map<string, Window>()

  constructor(private readonly limits: ThrottleLimits = DEFAULT_THROTTLE_LIMITS) {}

  /**
   * Run one comparison for this client, unless it has failed too often lately.
   *
   * The refusal comes BEFORE the comparison, because one after it would refuse
   * nothing. `compare` is synchronous (a thenable is refused by its type), so
   * the refusal, the comparison and the count are one step: a burst sent at
   * once is held to the same ceiling as a sequence.
   */
  attempt<T extends object & { then?: never }>(
    address: string,
    now: EpochMs,
    compare: () => T | null,
  ): ThrottledAttempt<T> {
    const client = bucketOf(address)
    const window = this.current(client, now)
    if (window !== null && window.failures >= this.limits.maxFailures) {
      const retryAfterMs = window.startedAt + this.limits.windowMs - now
      return { kind: 'refused', retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
    }
    const match = compare()
    if (match === null) this.countFailure(client, window, now)
    return { kind: 'compared', match }
  }

  private countFailure(client: string, window: Window | null, now: EpochMs): void {
    if (window !== null) {
      window.failures += 1
      return
    }
    // The oldest entry goes first. A Map iterates in insertion order and a
    // window is inserted when it starts, so the first key is the stalest.
    if (this.windows.size >= this.limits.maxClients) {
      const oldest = this.windows.keys().next()
      if (oldest.done !== true) this.windows.delete(oldest.value)
    }
    this.windows.set(client, { startedAt: now, failures: 1 })
  }

  /** The client's open window, dropping one that has run out. */
  private current(client: string, now: EpochMs): Window | null {
    const window = this.windows.get(client)
    if (window === undefined) return null
    if (now - window.startedAt < this.limits.windowMs) return window
    this.windows.delete(client)
    return null
  }
}

/**
 * The bucket an address counts against.
 *
 * An IPv6 end site is commonly handed a /48, so keying on the full address,
 * or on a /64, would give one guesser 65,536 buckets or more of `maxFailures`
 * each, and enough of them to push every other client out of `maxClients`
 * (its own refused window included). Its /48 is the client. IPv4, an
 * IPv4-mapped address and anything that does not parse as IPv6 count as
 * themselves.
 */
export function bucketOf(address: string): string {
  const bare = (address.split('%')[0] ?? address).toLowerCase()
  if (!bare.includes(':')) return bare
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare)?.[1]
  if (mapped !== undefined) return mapped
  const groups = ipv6Groups(bare)
  return groups === null ? bare : `${groups.slice(0, 3).join(':')}::/48`
}

const HEXTET = /^[0-9a-f]{1,4}$/

/** The eight groups of an IPv6 address with `::` expanded, or null when it is not one. */
function ipv6Groups(address: string): string[] | null {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] === '' ? [] : (halves[0]?.split(':') ?? [])
  const right = halves[1] === undefined || halves[1] === '' ? [] : halves[1].split(':')
  const elided = 8 - left.length - right.length
  if (halves.length === 1 ? elided !== 0 : elided < 1) return null
  const groups = [
    ...left,
    ...Array.from({ length: halves.length === 1 ? 0 : elided }, () => '0'),
    ...right,
  ]
  if (!groups.every((group) => HEXTET.test(group))) return null
  return groups.map((group) => Number.parseInt(group, 16).toString(16))
}
