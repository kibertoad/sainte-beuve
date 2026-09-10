import {
  UpstreamFailedError,
  type VcsAccount,
  type VcsIdentityGateway,
  getErrorMessage,
} from '@sainte-beuve/kernel'
import { GITHUB_WEB_BASE_URL, githubRequest } from './client.js'

/**
 * "Sign in with GitHub": the user-to-server OAuth web flow, which is how a
 * deployment gets a GitHub credential without anybody pasting a secret.
 *
 * Works against either a GitHub App's OAuth credentials or a classic OAuth app,
 * because both expose the same `/login/oauth/*` endpoints. A GitHub App's client
 * id and secret are the right ones to use when the deployment has an App: the
 * sign-in then identifies the operator, and the App's own installation tokens do
 * the repository work.
 *
 * What this is NOT is user authentication for sainte-beuve. There are no sessions
 * yet (docs/implementation-plan.md, slice 6), so signing in CONNECTS GitHub: the
 * callback stores the resulting token as this deployment's GitHub credential and
 * nothing else. Saying so matters, because a screen that shows a GitHub avatar
 * usually means the opposite.
 */

/** Enough to identify the signer. The App's own permissions govern repository access. */
const DEFAULT_SCOPE = 'read:user'

export interface GitHubIdentityGatewayOptions {
  clientId: string
  clientSecret: string
  /** REST API base, for reading the user. Defaults to api.github.com. */
  apiBaseUrl?: string
  /** OAuth host, for authorize and token. Defaults to github.com. */
  webBaseUrl?: string
  /**
   * Scopes to request. `read:user` by default: a deployment reaching
   * repositories with this credential rather than with an App has to ask for
   * `repo` as well, which is exactly the kind of grant it should have to name.
   */
  scope?: string
  fetchImpl?: typeof globalThis.fetch
}

interface TokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

export class GitHubIdentityGateway implements VcsIdentityGateway {
  constructor(private readonly options: GitHubIdentityGatewayOptions) {}

  authorizeUrl(input: { redirectUri: string; state: string }): string {
    const url = new URL('/login/oauth/authorize', this.options.webBaseUrl ?? GITHUB_WEB_BASE_URL)
    url.searchParams.set('client_id', this.options.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('state', input.state)
    url.searchParams.set('scope', this.options.scope ?? DEFAULT_SCOPE)
    // No signup detour: whoever is connecting a deployment to GitHub has an account.
    url.searchParams.set('allow_signup', 'false')
    return url.toString()
  }

  async exchangeCode(input: {
    code: string
    redirectUri: string
  }): Promise<{ token: string; account: VcsAccount }> {
    const token = await this.postForToken(input)
    const user = await githubRequest<{
      id: number
      login: string
      name?: string | null
      avatar_url?: string | null
    }>({
      path: '/user',
      token,
      baseUrl: this.options.apiBaseUrl,
      fetchImpl: this.options.fetchImpl,
    })
    return {
      token,
      account: {
        subject: String(user.id),
        username: user.login,
        displayName: user.name ?? null,
        avatarUrl: user.avatar_url ?? null,
      },
    }
  }

  private async postForToken(input: { code: string; redirectUri: string }): Promise<string> {
    const url = new URL('/login/oauth/access_token', this.options.webBaseUrl ?? GITHUB_WEB_BASE_URL)
    let response: Response
    try {
      response = await (this.options.fetchImpl ?? globalThis.fetch)(url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      })
    } catch (err) {
      throw new UpstreamFailedError(`Could not reach GitHub: ${getErrorMessage(err)}`)
    }
    if (!response.ok) {
      throw new UpstreamFailedError(`GitHub answered ${response.status} to the code exchange`)
    }
    const body = (await response.json()) as TokenResponse
    // GitHub answers 200 with `{ error }` for an expired or replayed code, so the
    // status alone is not the answer. `bad_verification_code` is what a stale
    // callback looks like, and it is the one slug worth carrying through.
    if (!body.access_token) {
      throw new UpstreamFailedError(
        `GitHub refused the sign-in: ${body.error_description ?? body.error ?? 'no token returned'}`,
      )
    }
    return body.access_token
  }
}
