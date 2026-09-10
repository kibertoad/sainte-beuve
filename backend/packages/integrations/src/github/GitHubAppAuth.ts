import { base64url, base64urlText, type Clock, systemClock } from '@sainte-beuve/kernel'
import { GitHubApiError, githubRequest } from './client.js'

/**
 * GitHub App authentication, on Web Crypto alone so it runs unchanged inside
 * workerd and under Node.
 *
 * Two credentials, and the difference matters:
 *   - the APP JWT (RS256, signed with the App's private key) authenticates as the
 *     App itself. It can read which installations exist and mint tokens, and it
 *     can touch no repository.
 *   - an INSTALLATION token (~1h) authenticates as one installation, and that is
 *     what every repository call uses.
 *
 * There is no installation TABLE. An installation is resolved from the repository
 * it is being used for (`GET /repos/{owner}/{repo}/installation`), which is the
 * one question a caller actually has, and the answer is cached in memory. The
 * alternative, a binding persisted once at install time, is a row that silently
 * stops matching the day somebody changes the App's repository access on GitHub,
 * and its only advantage would be saving a request that is already cached.
 *
 * Tokens are held in memory and never persisted: a live repository-write
 * credential at rest is readable from any store dump, and a cache miss costs one
 * signature and one round trip.
 */

/** Treat a token as lapsed early, so one is never picked up moments before it dies. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000
/** Fallback life for a mint whose `expires_at` did not parse. */
const ASSUMED_LIFETIME_MS = 30 * 60 * 1000
/** The App JWT's life. GitHub caps it at 10 minutes and refuses a longer one. */
const JWT_LIFETIME_SECONDS = 9 * 60
/** Backdate `iat` to tolerate a clock a little ahead of GitHub's. */
const JWT_BACKDATE_SECONDS = 60

const PKCS1_HINT =
  'GITHUB_APP_PRIVATE_KEY is PKCS#1 (it begins with "BEGIN RSA PRIVATE KEY"), which Web Crypto ' +
  'cannot import. GitHub issues PKCS#1: convert it once with ' +
  '`openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pk8.pem` and set the result.'

const IMPORT_HINT =
  'GITHUB_APP_PRIVATE_KEY could not be imported as a PKCS#8 RSA private key. Check that it is ' +
  'the GitHub App key, in PKCS#8 PEM, with its line breaks intact.'

export interface GitHubAppAuthOptions {
  appId: string
  /** The App private key, PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`). */
  privateKeyPem: string
  /** Override for GitHub Enterprise Server. Defaults to api.github.com. */
  baseUrl?: string
  clock?: Clock
  /** Swap the HTTP implementation. Defaults to the global `fetch`. */
  fetchImpl?: typeof globalThis.fetch
}

interface AccessTokenResponse {
  token: string
  expires_at: string
}

interface CachedToken {
  token: string
  /** When to stop serving it, already reduced by {@link EXPIRY_SKEW_MS}. */
  freshUntil: number
}

export class GitHubAppAuth {
  private readonly options: GitHubAppAuthOptions
  private readonly clock: Clock
  private keyPromise?: Promise<CryptoKey>
  /** installationId -> token. Bounded by the number of orgs that installed the App. */
  private readonly tokens = new Map<number, CachedToken>()
  /** `owner/repo` -> installation id. Immutable on GitHub, so it never needs invalidating. */
  private readonly installations = new Map<string, number>()

  constructor(options: GitHubAppAuthOptions) {
    this.options = options
    this.clock = options.clock ?? systemClock
  }

  /** A short-lived RS256 JWT authenticating as the App. */
  async appJwt(): Promise<string> {
    const nowSeconds = Math.floor(this.clock.now() / 1000)
    const header = base64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64urlText(
      JSON.stringify({
        iat: nowSeconds - JWT_BACKDATE_SECONDS,
        exp: nowSeconds + JWT_LIFETIME_SECONDS,
        iss: this.options.appId,
      }),
    )
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      await this.importKey(),
      new TextEncoder().encode(`${header}.${payload}`),
    )
    return `${header}.${payload}.${base64url(new Uint8Array(signature))}`
  }

  /** A token authenticating as the installation that owns `owner/repo`. */
  async tokenForRepo(owner: string, repo: string): Promise<string> {
    return this.installationToken(await this.installationForRepo(owner, repo))
  }

  /** Which installation covers a repository, cached for the life of the process. */
  async installationForRepo(owner: string, repo: string): Promise<number> {
    const key = `${owner}/${repo}`
    const known = this.installations.get(key)
    if (known !== undefined) return known
    const installation = await this.request<{ id: number }>({
      path: `/repos/${owner}/${repo}/installation`,
      subject: key,
    })
    this.installations.set(key, installation.id)
    return installation.id
  }

  private async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId)
    if (cached !== undefined && cached.freshUntil > this.clock.now()) return cached.token

    const minted = await this.request<AccessTokenResponse>({
      method: 'POST',
      path: `/app/installations/${installationId}/access_tokens`,
      subject: `installation ${installationId}`,
    })
    const expiresAt = Date.parse(minted.expires_at)
    const lapsesAt = Number.isNaN(expiresAt) ? this.clock.now() + ASSUMED_LIFETIME_MS : expiresAt
    this.tokens.set(installationId, { token: minted.token, freshUntil: lapsesAt - EXPIRY_SKEW_MS })
    return minted.token
  }

  /** Every app-JWT-authenticated call, with its refusals turned into instructions. */
  private async request<T>(input: {
    path: string
    subject: string
    method?: 'GET' | 'POST'
  }): Promise<T> {
    try {
      return await githubRequest<T>({
        method: input.method ?? 'GET',
        path: input.path,
        token: await this.appJwt(),
        baseUrl: this.options.baseUrl,
        fetchImpl: this.options.fetchImpl,
      })
    } catch (err) {
      throw explain(err, input.subject)
    }
  }

  /**
   * Imported once and memoised, because it is the expensive half: an RSA import
   * per call would be paid on every repository request, on a runtime billed by
   * CPU time. The PKCS#1 case is named rather than left to Web Crypto's
   * "operation failed" DOMException, because it is the shape GitHub hands out and
   * therefore the one every operator meets first.
   */
  private importKey(): Promise<CryptoKey> {
    this.keyPromise ??= crypto.subtle
      .importKey(
        'pkcs8',
        pemToDer(this.options.privateKeyPem),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      .catch((cause: unknown) => {
        throw new Error(IMPORT_HINT, { cause })
      })
    return this.keyPromise
  }
}

/** Turn GitHub's refusals of an App credential into the instruction that fixes each. */
function explain(err: unknown, subject: string): unknown {
  if (!(err instanceof GitHubApiError)) return err
  if (err.status === 401) {
    return new GitHubApiError(
      err.status,
      'GitHub refused this deployment as a GitHub App: check that GITHUB_APP_ID names the App ' +
        'whose private key GITHUB_APP_PRIVATE_KEY holds, and that the key has not been rotated ' +
        `in the App settings (${err.message})`,
    )
  }
  if (err.status === 404 || err.status === 410) {
    return new GitHubApiError(
      err.status,
      `This deployment's GitHub App is not installed on ${subject}: install it on the ` +
        'organisation that owns the repository, and grant it access to that repository.',
    )
  }
  return err
}

/**
 * A PEM private key body as DER bytes. The PKCS#1 check is first because GitHub
 * hands out PKCS#1 while Web Crypto imports only PKCS#8, so it is the failure
 * that comes before every other.
 */
function pemToDer(pem: string): ArrayBuffer {
  if (pem.includes('BEGIN RSA PRIVATE KEY')) throw new Error(PKCS1_HINT)
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  if (body.length === 0) throw new Error('GITHUB_APP_PRIVATE_KEY holds no PEM body')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
