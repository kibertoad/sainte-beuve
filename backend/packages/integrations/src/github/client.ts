import { UpstreamFailedError, getErrorMessage, withDeadline } from '@sainte-beuve/kernel'

/**
 * The only place in the tree that calls GitHub.
 *
 * Plain `fetch` rather than Octokit, for the same reason `SlackChatGateway` is
 * plain `fetch` rather than `@slack/web-api`, plus one that is specific to the
 * App path: `@octokit/auth-app` signs the app JWT with `node:crypto`, which
 * workerd does not provide, so the credential half of GitHub App support would
 * have needed hand-writing anyway. The surface we use is five endpoints, and
 * `crypto.subtle` already signs RS256 on every runtime we target.
 *
 * Every failure leaves here as an `UpstreamFailedError` carrying the status,
 * because that is the one thing a caller can act on: a 401 is a credential to
 * re-enter and a 404 on an installation lookup is an App nobody installed.
 *
 * Every call carries a DEADLINE (`withDeadline`), because the widest fan-out in
 * the tree is here: a workspace read asks every registered project at once, and
 * one host that accepts a connection and never answers would otherwise hold a
 * person's whole screen open.
 */

const USER_AGENT = 'sainte-beuve'
const API_VERSION = '2022-11-28'

export const GITHUB_API_BASE_URL = 'https://api.github.com'
export const GITHUB_WEB_BASE_URL = 'https://github.com'

/** A GitHub answer that was not a success, with the status kept as a field. */
export class GitHubApiError extends UpstreamFailedError {
  readonly status: number

  constructor(status: number, message: string) {
    super(message, { status })
    this.status = status
  }
}

export function githubApiStatusOf(err: unknown): number | undefined {
  return err instanceof GitHubApiError ? err.status : undefined
}

/**
 * A path under `/repos/{owner}/{repo}`, with both segments ENCODED.
 *
 * Every GitHub call this package makes about a repository goes through here,
 * and the encoding is the reason it exists rather than the five template
 * literals it replaces. `owner` and `repo` arrive from a route body, and `fetch`
 * normalises `..` and truncates at `?` before the request leaves the process: an
 * unencoded pair therefore chooses the METHOD and the PATH the org’s credential
 * is spent on, not merely the repository it is spent about. The contracts refuse
 * those characters as well (see `repoOwnerSchema`), and this is the half that
 * holds for a ref from a store written by an older build.
 *
 * `suffix` is composed here rather than passed as segments because everything
 * after the repository is a fixed string plus a validated integer.
 */
export function repoPath(ref: { owner: string; repo: string }, suffix = ''): string {
  return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}${suffix}`
}

export interface GitHubRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  /** `Bearer <token>`: an installation token, a user token, or an app JWT. */
  token: string
  body?: unknown
  /** Base URL, for GitHub Enterprise Server. Defaults to api.github.com. */
  baseUrl?: string
  /** Swap the HTTP implementation. Defaults to the global `fetch`. */
  fetchImpl?: typeof globalThis.fetch
}

/**
 * One GitHub call, returning the parsed body. A 204 (which several of the write
 * endpoints answer with) parses as null rather than throwing on an empty body.
 */
export async function githubRequest<T>(request: GitHubRequest): Promise<T> {
  const url = `${trimBase(request.baseUrl)}${request.path}`
  let response: Response
  try {
    response = await withDeadline(request.fetchImpl)(url, {
      method: request.method ?? 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${request.token}`,
        'user-agent': USER_AGENT,
        'x-github-api-version': API_VERSION,
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    })
  } catch (err) {
    throw new UpstreamFailedError(`Could not reach GitHub: ${getErrorMessage(err)}`)
  }
  if (!response.ok) throw new GitHubApiError(response.status, await describe(response, request))
  return (await parse(response)) as T
}

/**
 * `||` rather than `??`: a base URL somebody left BLANK is one they did not
 * set. Every example deployment ships the name with no value, so a copied file
 * gives `''`, and `''` as the base would build every path relative and fail as
 * `TypeError: Failed to parse URL`.
 */
function trimBase(baseUrl: string | undefined): string {
  return (baseUrl || GITHUB_API_BASE_URL).replace(/\/+$/, '')
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    // A body GitHub says is JSON and is not means a proxy answered, not GitHub.
    throw new UpstreamFailedError('GitHub answered with a body that is not JSON')
  }
}

/**
 * The refusal, with GitHub's own `message` when there is one. Worth reading out
 * of the body rather than reporting the status alone: "Resource not accessible by
 * integration" is the answer to "why did the App's comment fail?", and it is the
 * only place the missing permission is named.
 */
async function describe(response: Response, request: GitHubRequest): Promise<string> {
  const detail = await response
    .json()
    .then((body) => (body as { message?: string }).message)
    .catch(() => undefined)
  const method = request.method ?? 'GET'
  const suffix = detail === undefined ? '' : `: ${detail}`
  return `GitHub answered ${response.status} for ${method} ${request.path}${suffix}`
}
