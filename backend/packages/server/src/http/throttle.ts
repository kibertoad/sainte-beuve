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

/**
 * How often one client may present a bearer credential that matches nothing.
 *
 * Minted keys and sessions are 256-bit and nobody guesses one. `AUTH_API_KEY` is
 * whatever an operator typed, it is an ADMIN of the default org, and it is
 * compared on every bearer attempt. Without a ceiling, the only thing between a
 * weak one and a stranger is how fast the stranger can send requests.
 * `environmentApiKeyFrom` refuses the short ones; this is the other half.
 *
 * WHAT IS COUNTED is a presented bearer that verified to nobody, and nothing
 * else. Not a request with no credential, which is the ordinary state of an
 * `open` deployment and of the sign-in screen. Not a session cookie that no
 * longer resolves, which is every browser whose session expired overnight and
 * guesses nothing. And a session that DOES resolve is answered before this is
 * asked, so a browser behind the same address as a guesser keeps working.
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
   * Admit one bearer for comparison: the seconds this client must wait, or null
   * once the attempt is counted as a failure that `forgive` takes back if it
   * matches.
   *
   * Asked BEFORE the comparison, because a refusal after it would refuse
   * nothing. Asking and counting in one call is what holds the ceiling for a
   * burst: split across an `await`, every guess sent at once would be asked
   * before the first of them had been counted.
   */
  attempt(address: string, now: EpochMs): number | null {
    const client = bucketOf(address)
    const window = this.current(client, now)
    if (window !== null && window.failures >= this.limits.maxFailures) {
      return Math.max(1, Math.ceil((window.startedAt + this.limits.windowMs - now) / 1000))
    }
    if (window !== null) {
      window.failures += 1
      return null
    }
    // The oldest entry goes first. A Map iterates in insertion order and a
    // window is inserted when it starts, so the first key is the stalest.
    if (this.windows.size >= this.limits.maxClients) {
      const oldest = this.windows.keys().next()
      if (oldest.done !== true) this.windows.delete(oldest.value)
    }
    this.windows.set(client, { startedAt: now, failures: 1 })
    return null
  }

  /** Take back the count `attempt` made for a bearer that matched, or never got compared. */
  forgive(address: string, now: EpochMs): void {
    const client = bucketOf(address)
    const window = this.current(client, now)
    if (window === null) return
    window.failures -= 1
    if (window.failures <= 0) this.windows.delete(client)
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
 * An IPv6 client is handed a /64 at the least, so keying on the full address
 * would give one guesser 2^64 buckets of `maxFailures` each, and enough of them
 * to push every other client out of `maxClients`. Its /64 is the client. IPv4,
 * an IPv4-mapped address and anything that does not parse as IPv6 count as
 * themselves.
 */
export function bucketOf(address: string): string {
  const bare = (address.split('%')[0] ?? address).toLowerCase()
  if (!bare.includes(':')) return bare
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare)?.[1]
  if (mapped !== undefined) return mapped
  const groups = ipv6Groups(bare)
  return groups === null ? bare : `${groups.slice(0, 4).join(':')}::/64`
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
