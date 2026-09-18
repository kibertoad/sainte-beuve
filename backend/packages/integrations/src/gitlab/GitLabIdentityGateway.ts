import {
  UpstreamFailedError,
  type VcsAccount,
  type VcsIdentityGateway,
  getErrorMessage,
  withDeadline,
} from '@sainte-beuve/kernel'
import { GITLAB_BASE_URL, gitlabRequest } from './client.js'

/**
 * "Sign in with GitLab": the OAuth authorization-code flow, which is how a
 * deployment gets a GitLab credential without anybody pasting a secret.
 *
 * Works against gitlab.com and against a self-managed install alike, because
 * both serve `/oauth/authorize` and `/oauth/token` under the same root as the
 * API. One base URL therefore configures the whole connection, which is the
 * difference from GitHub, where the API and the OAuth endpoints live on two
 * hosts.
 *
 * What this is NOT is user authentication for sainte-beuve. There are no
 * sessions yet (docs/implementation-plan.md, slice 6), so signing in CONNECTS
 * GitLab: the callback stores the resulting token as this deployment's GitLab
 * credential, and the account behind it is what the workspace treats as the
 * viewer.
 */

/**
 * Enough to read the signer AND the merge requests the workspace lists.
 * `read_user` alone would identify them and then show an empty workspace, which
 * is the worse of the two defaults: a scope that is too narrow fails as missing
 * data rather than as a refusal anybody can diagnose.
 */
const DEFAULT_SCOPE = 'read_api'

export interface GitLabIdentityGatewayOptions {
  clientId: string
  clientSecret: string
  /** The install's root, serving both the API and the OAuth endpoints. */
  baseUrl?: string
  scope?: string
  fetchImpl?: typeof globalThis.fetch
}

interface TokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface GitLabUser {
  id: number
  username: string
  name?: string | null
  avatar_url?: string | null
}

export class GitLabIdentityGateway implements VcsIdentityGateway {
  constructor(private readonly options: GitLabIdentityGatewayOptions) {}

  authorizeUrl(input: { redirectUri: string; state: string }): string {
    const url = new URL('/oauth/authorize', this.root())
    url.searchParams.set('client_id', this.options.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', input.state)
    url.searchParams.set('scope', this.options.scope ?? DEFAULT_SCOPE)
    return url.toString()
  }

  async exchangeCode(input: {
    code: string
    redirectUri: string
  }): Promise<{ token: string; account: VcsAccount }> {
    const token = await this.postForToken(input)
    const user = await gitlabRequest<GitLabUser>({
      path: '/user',
      token,
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
    })
    return {
      token,
      account: {
        subject: String(user.id),
        username: user.username,
        displayName: user.name ?? null,
        avatarUrl: user.avatar_url ?? null,
      },
    }
  }

  /** `||`, so a `GITLAB_BASE_URL` left blank means gitlab.com and not a relative URL. */
  private root(): string {
    return (this.options.baseUrl || GITLAB_BASE_URL).replace(/\/+$/, '')
  }

  private async postForToken(input: { code: string; redirectUri: string }): Promise<string> {
    const url = new URL('/oauth/token', this.root())
    let response: Response
    try {
      response = await withDeadline(this.options.fetchImpl)(url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          code: input.code,
          grant_type: 'authorization_code',
          redirect_uri: input.redirectUri,
        }),
      })
    } catch (err) {
      throw new UpstreamFailedError(`Could not reach GitLab: ${getErrorMessage(err)}`)
    }
    const body = (await response.json().catch(() => ({}))) as TokenResponse
    if (!response.ok || !body.access_token) {
      throw new UpstreamFailedError(
        `GitLab refused the sign-in: ${
          body.error_description ?? body.error ?? `answered ${response.status}`
        }`,
      )
    }
    return body.access_token
  }
}
