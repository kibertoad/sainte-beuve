import { UpstreamFailedError, getErrorMessage } from '@sainte-beuve/kernel'

/**
 * The only place in the tree that calls GitLab.
 *
 * A sibling of the GitHub client rather than a shared one, and deliberately so:
 * the two hosts disagree about almost everything at the wire (a project is one
 * URL-encoded path segment where a repository is two, a merge request is
 * addressed by `iid`, reviewers are numeric ids rather than handles, and the
 * error body carries `message` or `error` depending on which layer refused). A
 * client abstract enough to serve both would be a third dialect neither adapter
 * speaks. What IS shared is the port above them.
 *
 * Every failure leaves here as an `UpstreamFailedError` carrying the status,
 * because that is the one thing a caller can act on: a 401 is a credential to
 * re-enter and a 404 on a project is one this token cannot see.
 */

const USER_AGENT = 'sainte-beuve'

export const GITLAB_BASE_URL = 'https://gitlab.com'

/** GitLab serves its REST API under this prefix on every install, hosted or not. */
const API_PREFIX = '/api/v4'

/** A GitLab answer that was not a success, with the status kept as a field. */
export class GitLabApiError extends UpstreamFailedError {
  readonly status: number

  constructor(status: number, message: string) {
    super(message, { status })
    this.status = status
  }
}

export function gitlabApiStatusOf(err: unknown): number | undefined {
  return err instanceof GitLabApiError ? err.status : undefined
}

/**
 * A project's API path segment. GitLab addresses a project either by numeric id
 * or by its full path URL-ENCODED into one segment, and the second is the only
 * one we can build from what a person typed: `platform/backend/api` becomes
 * `platform%2Fbackend%2Fapi`, which is also why a nested namespace needs no
 * special handling anywhere above this line.
 */
export function projectPath(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`)
}

export interface GitLabRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Path under `/api/v4`, e.g. `/projects/x/merge_requests`. */
  path: string
  /** A personal access token or an OAuth token; GitLab accepts both as a bearer. */
  token: string
  body?: unknown
  /** The install's root, e.g. `https://gitlab.example.com`. Defaults to gitlab.com. */
  baseUrl?: string
  /** Swap the HTTP implementation. Defaults to the global `fetch`. */
  fetchImpl?: typeof globalThis.fetch
}

/** One GitLab call, returning the parsed body. A 204 parses as null. */
export async function gitlabRequest<T>(request: GitLabRequest): Promise<T> {
  const url = `${trimBase(request.baseUrl)}${API_PREFIX}${request.path}`
  let response: Response
  try {
    response = await (request.fetchImpl ?? globalThis.fetch)(url, {
      method: request.method ?? 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${request.token}`,
        'user-agent': USER_AGENT,
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    })
  } catch (err) {
    throw new UpstreamFailedError(`Could not reach GitLab: ${getErrorMessage(err)}`)
  }
  if (!response.ok) throw new GitLabApiError(response.status, await describe(response, request))
  return (await parse(response)) as T
}

function trimBase(baseUrl: string | undefined): string {
  return (baseUrl ?? GITLAB_BASE_URL).replace(/\/+$/, '')
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    // A body GitLab says is JSON and is not means a proxy answered, not GitLab.
    throw new UpstreamFailedError('GitLab answered with a body that is not JSON')
  }
}

/**
 * The refusal, with GitLab's own text when there is one. Two fields to look at,
 * not one: the API layer answers `{ message }` and the OAuth layer answers
 * `{ error, error_description }`, and reading only the first reports an expired
 * token as a bare 401.
 */
async function describe(response: Response, request: GitLabRequest): Promise<string> {
  const detail = await response
    .json()
    .then((body) => detailOf(body as Record<string, unknown>))
    .catch(() => undefined)
  const method = request.method ?? 'GET'
  const suffix = detail === undefined ? '' : `: ${detail}`
  return `GitLab answered ${response.status} for ${method} ${request.path}${suffix}`
}

function detailOf(body: Record<string, unknown>): string | undefined {
  for (const key of ['message', 'error_description', 'error']) {
    const value = body[key]
    if (typeof value === 'string') return value
  }
  return undefined
}
