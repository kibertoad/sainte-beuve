import { isDomainError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { environmentApiKeyFrom } from '../src/config/apiKey.js'
import { bucketOf, CredentialThrottle } from '../src/http/throttle.js'
import { ApiKeyService } from '../src/modules/auth/ApiKeyService.js'
import { buildHarness, type TestHarness } from './helpers.js'

/**
 * L4 and L10 of the security review: what every response carries, and what a
 * client that keeps presenting keys that match nothing gets.
 */

const OPERATOR_KEY = 'a'.repeat(16) + 'b'.repeat(16)
const LIMITS = { maxFailures: 3, windowMs: 60_000, maxClients: 2 }

function bearer(token: string, client = '203.0.113.7'): Request {
  return new Request('http://localhost/api/v1/reviews', {
    headers: { authorization: `Bearer ${token}`, 'x-test-client': client },
  })
}

/** A `required` deployment holding `AUTH_API_KEY`, its client read off a test header. */
function guarded(): TestHarness {
  const harness = buildHarness({
    auth: { ...buildHarness().container.auth, mode: 'required', environmentApiKey: OPERATOR_KEY },
  })
  const app = createApp({
    resolveContainer: () => harness.container,
    clientAddress: (scope) => scope.req.headers.get('x-test-client'),
  })
  return { ...harness, app }
}

describe('response headers', () => {
  it('carries the security headers on a route, a refusal and the probe', async () => {
    const { app } = buildHarness()
    for (const path of ['/api/v1/reviews', '/api/v1/nowhere', '/health']) {
      const res = await app.fetch(new Request(`http://localhost${path}`))
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    }
  })

  it('keeps authenticated JSON out of every cache, and leaves the probe alone', async () => {
    const { app } = buildHarness()
    const api = await app.fetch(new Request('http://localhost/api/v1/reviews'))
    expect(api.headers.get('cache-control')).toBe('no-store')
    const health = await app.fetch(new Request('http://localhost/health'))
    expect(health.headers.get('cache-control')).toBeNull()
  })
})

describe('failed API keys', () => {
  it('refuses a client that keeps guessing, before comparing its next guess', async () => {
    const { app } = guarded()
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await app.fetch(bearer(`guess-${attempt}`))).status).toBe(401)
    }
    // The right key, from the guessing address: refused rather than compared,
    // or the throttle would refuse nothing.
    const refused = await app.fetch(bearer(OPERATOR_KEY))
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
    const body = (await refused.json()) as { error: { code: string } }
    expect(body.error.code).toBe('rate_limited')
  })

  it('leaves another client, and the guessing one once its window ends, alone', async () => {
    const { app, clock } = guarded()
    for (let attempt = 0; attempt < 20; attempt++) await app.fetch(bearer(`guess-${attempt}`))
    expect((await app.fetch(bearer(OPERATOR_KEY, '198.51.100.1'))).status).toBe(200)
    clock.advance(10 * 60 * 1000)
    expect((await app.fetch(bearer(OPERATOR_KEY))).status).toBe(200)
  })

  it('holds the ceiling for a burst of guesses sent at once', async () => {
    const { app } = guarded()
    const statuses = await Promise.all(
      Array.from({ length: 25 }, async (_, n) => (await app.fetch(bearer(`guess-${n}`))).status),
    )
    expect(statuses.filter((status) => status === 401)).toHaveLength(20)
    expect(statuses.filter((status) => status === 429)).toHaveLength(5)
  })

  it('does not count a key that matched', async () => {
    const { app } = guarded()
    for (let attempt = 0; attempt < 19; attempt++) await app.fetch(bearer(`guess-${attempt}`))
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await app.fetch(bearer(OPERATOR_KEY))).status).toBe(200)
    }
  })

  it('does not count a request that presented nothing', async () => {
    const { app } = guarded()
    for (let attempt = 0; attempt < 25; attempt++) {
      const res = await app.fetch(new Request('http://localhost/api/v1/reviews'))
      expect(res.status).toBe(401)
    }
    expect((await app.fetch(bearer(OPERATOR_KEY))).status).toBe(200)
  })

  it('keeps a minted key working from an address that is refused', async () => {
    const harness = guarded()
    const { token } = await new ApiKeyService(harness.container).mint({
      label: 'release pipeline',
      role: 'member',
      createdBy: null,
    })
    for (let attempt = 0; attempt < 20; attempt++) {
      await harness.app.fetch(bearer(`guess-${attempt}`))
    }
    expect((await harness.app.fetch(bearer(OPERATOR_KEY))).status).toBe(429)
    expect((await harness.app.fetch(bearer(token))).status).toBe(200)
  })

  it('does not count a minted key that matched nothing, which nobody guesses', async () => {
    const { app } = guarded()
    for (let attempt = 0; attempt < 25; attempt++) {
      expect((await app.fetch(bearer(`sbk_guess-${attempt}`))).status).toBe(401)
    }
    expect((await app.fetch(bearer(OPERATOR_KEY))).status).toBe(200)
  })

  it('does not count a bearer nothing could match, such as a proxy token', async () => {
    const { app } = buildHarness()
    for (let attempt = 0; attempt < 25; attempt++) {
      expect((await app.fetch(bearer(`proxy-token-${attempt}`))).status).toBe(200)
    }
  })
})

describe('CredentialThrottle', () => {
  const miss = () => null
  const hit = () => ({ matched: true })

  it('refuses without comparing once the ceiling is reached, until the window ends', () => {
    const throttle = new CredentialThrottle(LIMITS)
    for (let n = 0; n < 3; n++) throttle.attempt('a', 0, miss)
    let compared = false
    const refused = throttle.attempt('a', 1_000, () => {
      compared = true
      return { matched: true }
    })
    expect(refused).toStrictEqual({ kind: 'refused', retryAfterSeconds: 59 })
    expect(compared).toBe(false)
    expect(throttle.attempt('a', 60_000, hit)).toStrictEqual({
      kind: 'compared',
      match: { matched: true },
    })
  })

  it('does not count a comparison that matched', () => {
    const throttle = new CredentialThrottle(LIMITS)
    for (let n = 0; n < 2; n++) throttle.attempt('a', 0, miss)
    for (let n = 0; n < 5; n++) throttle.attempt('a', 0, hit)
    expect(throttle.attempt('a', 0, miss).kind).toBe('compared')
    expect(throttle.attempt('a', 0, miss).kind).toBe('refused')
  })

  it('forgets the stalest client rather than growing without bound', () => {
    const throttle = new CredentialThrottle(LIMITS)
    for (let n = 0; n < 3; n++) throttle.attempt('a', 0, miss)
    throttle.attempt('b', 1, miss)
    throttle.attempt('c', 2, miss)
    expect(throttle.attempt('a', 3, miss).kind).toBe('compared')
  })
})

describe('bucketOf', () => {
  it('counts an IPv6 client by its /48, however it is spelled', () => {
    expect(bucketOf('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1::/48')
    expect(bucketOf('2001:0DB8:0001:ffff:ffff:0:0:9')).toBe('2001:db8:1::/48')
    expect(bucketOf('2001:db8::1')).toBe('2001:db8:0::/48')
  })

  it('counts IPv4, a mapped address and anything unparsed as itself', () => {
    expect(bucketOf('203.0.113.7')).toBe('203.0.113.7')
    expect(bucketOf('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(bucketOf('unknown')).toBe('unknown')
    expect(bucketOf('1::2::3')).toBe('1::2::3')
  })
})

function refusalOf(value: string): unknown {
  try {
    environmentApiKeyFrom(value)
    return null
  } catch (caught: unknown) {
    return caught
  }
}

describe('environmentApiKeyFrom', () => {
  it('reads blank as absent', () => {
    expect(environmentApiKeyFrom(undefined)).toBeNull()
    expect(environmentApiKeyFrom('')).toBeNull()
  })

  it('holds a long key as given', () => {
    expect(environmentApiKeyFrom(OPERATOR_KEY)).toBe(OPERATOR_KEY)
  })

  it('refuses a key short enough to guess, naming the variable', () => {
    const err = refusalOf('changeme')
    expect(isDomainError(err) && err.code).toBe('misconfigured')
    expect(err instanceof Error && err.message).toContain('AUTH_API_KEY')
  })

  it('refuses a key with the minted prefix, which would never be compared', () => {
    const err = refusalOf(`sbk_${OPERATOR_KEY}`)
    expect(isDomainError(err) && err.code).toBe('misconfigured')
    expect(err instanceof Error && err.message).toContain('sbk_')
  })
})
