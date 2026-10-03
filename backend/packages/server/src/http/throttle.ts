import type { EpochMs } from '@sainte-beuve/kernel'

/**
 * How often one client may present a bearer credential that matches nothing.
 *
 * Minted keys and sessions are 256-bit and nobody guesses one. `AUTH_API_KEY` is
 * whatever an operator typed, it is an ADMIN of the default org, and it is
 * compared on every bearer attempt — so without a ceiling, the only thing
 * between a weak one and a stranger is how fast the stranger can send requests.
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
 * that wants a hard one sets a rate-limiting rule at the edge as well. It is
 * still the difference between a guess per request and a guess per minute.
 *
 * Fixed windows rather than a sliding log: the question is "is this address
 * guessing", and a window answers it with one counter per address.
 */
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

export class CredentialThrottle {
  private readonly windows = new Map<string, Window>()

  constructor(private readonly limits: ThrottleLimits = DEFAULT_THROTTLE_LIMITS) {}

  /**
   * How many seconds this client must wait, or null when it may be answered.
   *
   * Asked BEFORE a bearer is verified, because a refusal after the comparison
   * would refuse nothing: the guess that matched would already have matched.
   */
  refusal(client: string, now: EpochMs): number | null {
    const window = this.current(client, now)
    if (window === null || window.failures < this.limits.maxFailures) return null
    return Math.max(1, Math.ceil((window.startedAt + this.limits.windowMs - now) / 1000))
  }

  /** Count one bearer that matched nobody. */
  failed(client: string, now: EpochMs): void {
    const window = this.current(client, now)
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
