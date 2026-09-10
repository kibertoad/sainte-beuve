import { base64url, base64urlToBytes } from '@sainte-beuve/kernel'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { GitHubAppAuth } from './GitHubAppAuth.js'

// The App credential path, end to end against a stubbed GitHub: the JWT is
// verified with the public half of a key generated here, so this proves the
// signature is one GitHub would accept rather than that a string was produced.

const CLOCK = { now: () => 1_780_000_000_000 }

let privateKeyPem: string
let publicKey: CryptoKey

/** A real RSA pair, so the JWT can be verified rather than merely inspected. */
async function generateKeyPair(): Promise<void> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(
    String.fromCharCode(...pkcs8),
  )}\n-----END PRIVATE KEY-----`
  publicKey = pair.publicKey
}

interface Call {
  url: string
  method: string
  authorization: string
}

/** A fetch that records what was asked and answers what GitHub would. */
function stubFetch(answers: Record<string, unknown>): {
  fetchImpl: typeof globalThis.fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({
      url: href,
      method: init?.method ?? 'GET',
      authorization: headers.authorization ?? '',
    })
    const match = Object.entries(answers).find(([path]) => href.endsWith(path))
    if (match === undefined) return new Response('{"message":"not found"}', { status: 404 })
    return new Response(JSON.stringify(match[1]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, calls }
}

function tokenAnswers(token = 'ghs_first', expiresInMs = 60 * 60 * 1000) {
  return {
    '/repos/kibertoad/sainte-beuve/installation': { id: 99 },
    '/app/installations/99/access_tokens': {
      token,
      expires_at: new Date(CLOCK.now() + expiresInMs).toISOString(),
    },
  }
}

describe('GitHubAppAuth', () => {
  beforeAll(generateKeyPair)

  it('signs an app JWT GitHub would accept', async () => {
    const auth = new GitHubAppAuth({ appId: '12345', privateKeyPem, clock: CLOCK })
    const [header, payload, signature] = (await auth.appJwt()).split('.')

    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      base64urlToBytes(signature ?? ''),
      new TextEncoder().encode(`${header}.${payload}`),
    )
    expect(verified).toBe(true)

    const claims = JSON.parse(new TextDecoder().decode(base64urlToBytes(payload ?? ''))) as {
      iss: string
      iat: number
      exp: number
    }
    expect(claims.iss).toBe('12345')
    // Backdated to tolerate a clock ahead of GitHub's, and inside the 10 minutes
    // GitHub caps `exp` at: a longer one is refused outright.
    expect(claims.iat).toBeLessThan(CLOCK.now() / 1000)
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60)
    // Unpadded base64url, because a padded segment is refused with no explanation.
    expect(signature).not.toContain('=')
  })

  it('resolves the installation from the repository and mints a token for it', async () => {
    const { fetchImpl, calls } = stubFetch(tokenAnswers())
    const auth = new GitHubAppAuth({ appId: '1', privateKeyPem, clock: CLOCK, fetchImpl })

    expect(await auth.tokenForRepo('kibertoad', 'sainte-beuve')).toBe('ghs_first')
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toStrictEqual([
      'GET /repos/kibertoad/sainte-beuve/installation',
      'POST /app/installations/99/access_tokens',
    ])
    // Both legs authenticate as the APP, with the JWT rather than with a token.
    expect(calls.every((call) => call.authorization.startsWith('Bearer ey'))).toBe(true)
  })

  it('reuses the token and the installation lookup while the token is fresh', async () => {
    const { fetchImpl, calls } = stubFetch(tokenAnswers())
    const auth = new GitHubAppAuth({ appId: '1', privateKeyPem, clock: CLOCK, fetchImpl })

    await auth.tokenForRepo('kibertoad', 'sainte-beuve')
    await auth.tokenForRepo('kibertoad', 'sainte-beuve')
    // Two calls, not four: this is the difference between one signature an hour
    // and one per repository call on a runtime billed by CPU time.
    expect(calls).toHaveLength(2)
  })

  it('mints again once the token is close enough to expiry to be risky', async () => {
    // Six minutes of life left, against a five-minute skew margin: a token that
    // lapses mid-request is worse than one round trip.
    const { fetchImpl, calls } = stubFetch(tokenAnswers('ghs_short', 6 * 60 * 1000))
    let now = CLOCK.now()
    const auth = new GitHubAppAuth({
      appId: '1',
      privateKeyPem,
      clock: { now: () => now },
      fetchImpl,
    })

    await auth.tokenForRepo('kibertoad', 'sainte-beuve')
    now += 2 * 60 * 1000
    await auth.tokenForRepo('kibertoad', 'sainte-beuve')
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2)
    // The installation lookup is not repeated: an installation belongs to one App
    // forever, so that answer never goes stale.
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1)
  })

  it('resolves the installation again when a reinstall makes the cached one dead', async () => {
    // Uninstalling and reinstalling on an organisation mints a NEW installation
    // id, so the cached one answers 404 for ever. Without the retry a warm
    // isolate tells an operator the App is not installed on the organisation
    // they have just installed it on, until something recycles the process.
    let installationId = 99
    let now = CLOCK.now()
    const minted: number[] = []
    const fetchImpl = (async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/installation')) return Response.json({ id: installationId })
      const asked = Number(/\/app\/installations\/(\d+)\/access_tokens$/.exec(href)?.[1])
      if (asked !== installationId) return new Response('{"message":"Not Found"}', { status: 404 })
      minted.push(asked)
      return Response.json({ token: `ghs_${asked}`, expires_at: new Date(now + 3_600_000) })
    }) as typeof globalThis.fetch
    const auth = new GitHubAppAuth({
      appId: '1',
      privateKeyPem,
      clock: { now: () => now },
      fetchImpl,
    })

    expect(await auth.tokenForRepo('kibertoad', 'sainte-beuve')).toBe('ghs_99')
    // An hour on, the token has lapsed and the App has been reinstalled, so the
    // mint is the first call to find out the cached installation is gone.
    now += 60 * 60 * 1000
    installationId = 4242
    expect(await auth.tokenForRepo('kibertoad', 'sainte-beuve')).toBe('ghs_4242')
    expect(minted).toStrictEqual([99, 4242])
  })

  it('says the App is not installed rather than reporting a 404', async () => {
    const { fetchImpl } = stubFetch({})
    const auth = new GitHubAppAuth({ appId: '1', privateKeyPem, clock: CLOCK, fetchImpl })

    await expect(auth.tokenForRepo('kibertoad', 'elsewhere')).rejects.toThrow(
      /not installed on kibertoad\/elsewhere/,
    )
  })

  it('names the PKCS#1 key GitHub hands out, which Web Crypto cannot import', async () => {
    const auth = new GitHubAppAuth({
      appId: '1',
      privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----',
      clock: CLOCK,
    })
    await expect(auth.appJwt()).rejects.toThrow(/openssl pkcs8 -topk8 -nocrypt/)
  })

  it('names the variable rather than reporting an opaque crypto failure', async () => {
    const auth = new GitHubAppAuth({
      appId: '1',
      privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${base64url(
        new Uint8Array([1, 2, 3]),
      )}\n-----END PRIVATE KEY-----`,
      clock: CLOCK,
    })
    await expect(auth.appJwt()).rejects.toThrow(/GITHUB_APP_PRIVATE_KEY/)
  })

  it('refuses the App credentials rather than blaming the installation on a 401', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"message":"Bad credentials"}', { status: 401 }),
    ) as unknown as typeof globalThis.fetch
    const auth = new GitHubAppAuth({ appId: '1', privateKeyPem, clock: CLOCK, fetchImpl })

    await expect(auth.tokenForRepo('kibertoad', 'sainte-beuve')).rejects.toThrow(/GITHUB_APP_ID/)
  })
})
