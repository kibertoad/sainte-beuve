import {
  base64url,
  base64urlText,
  base64urlToBytes,
  type Clock,
  type RoundTripState,
  type StateSigner,
  systemClock,
  timingSafeEqual,
} from '@sainte-beuve/kernel'

/**
 * The `StateSigner` every facade wires: HMAC-SHA-256 over a base64url payload,
 * on Web Crypto, so the same code runs inside workerd and under Node.
 *
 *   base64url(JSON claims) + "." + base64url(HMAC of that)
 *
 * The key is DERIVED from the deployment's master key through HKDF under its own
 * info label, not the master key itself. Signing states and sealing credentials
 * are different jobs, and using one key material for both means a weakness in
 * either reaches the other; the label is what keeps them separate while a
 * deployment still configures one secret.
 *
 * Rotating the master key invalidates outstanding states, which is the right
 * behaviour and costs nothing: a state lives minutes, and the operator whose
 * connect flow was interrupted clicks the button again.
 */

/** HKDF domain separation, so this key signs nothing the cipher's key could open. */
const INFO = 'sainte-beuve:round-trip-state'
/** Long enough that a state cannot be waited out, short enough to bound a replay. */
export const STATE_LIFETIME_MS = 10 * 60 * 1000

export interface HmacStateSignerOptions {
  /** The master key, base64. The same value the cipher is built from. */
  masterKeyBase64: string
  /**
   * The clock the expiry is read against. Injected rather than reaching for
   * `Date.now()`, because the lifetime IS behaviour: a suite has to be able to
   * walk a round trip, and one that signed against real time would only ever
   * exercise the unexpired case.
   */
  clock?: Clock
}

export class HmacStateSigner implements StateSigner {
  private readonly masterKey: Uint8Array<ArrayBuffer>
  private readonly clock: Clock
  private keyPromise?: Promise<CryptoKey>

  constructor(options: HmacStateSignerOptions) {
    this.masterKey = base64urlToBytes(options.masterKeyBase64.trim())
    this.clock = options.clock ?? systemClock
  }

  async sign(state: RoundTripState): Promise<string> {
    const body = base64urlText(JSON.stringify(state))
    return `${body}.${base64url(new Uint8Array(await this.mac(body)))}`
  }

  async verify(value: string | null, flow: string): Promise<RoundTripState | null> {
    if (value === null) return null
    const separator = value.indexOf('.')
    if (separator <= 0 || separator === value.length - 1) return null
    const body = value.slice(0, separator)

    // Everything below fails CLOSED. A callback is reached by whatever a browser
    // was pointed at, so a truncated state, a padded signature and a body that is
    // not JSON all have to answer "not ours" rather than throw out of the route.
    let provided: Uint8Array
    try {
      provided = base64urlToBytes(value.slice(separator + 1))
    } catch {
      return null
    }
    if (!timingSafeEqual(new Uint8Array(await this.mac(body)), provided)) return null
    return this.claims(body, flow)
  }

  private claims(body: string, flow: string): RoundTripState | null {
    let state: RoundTripState
    try {
      state = JSON.parse(new TextDecoder().decode(base64urlToBytes(body))) as RoundTripState
    } catch {
      return null
    }
    // The flow check is not a formality. One signing key serves every round trip,
    // so a state minted to install an App would otherwise be presentable to the
    // sign-in callback, and each callback has to accept only its own.
    if (state.flow !== flow) return null
    if (typeof state.exp !== 'number' || state.exp < this.clock.now()) return null
    return state
  }

  private async mac(input: string): Promise<ArrayBuffer> {
    this.keyPromise ??= this.deriveKey()
    return crypto.subtle.sign('HMAC', await this.keyPromise, new TextEncoder().encode(input))
  }

  private async deriveKey(): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey('raw', this.masterKey, 'HKDF', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        // A zero-length salt is what makes the derivation DETERMINISTIC, which it
        // has to be: the key that verifies a state on the callback is derived in a
        // different request, and on the Worker in a different isolate, from the
        // one that signed it.
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(INFO),
      },
      base,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  }
}
