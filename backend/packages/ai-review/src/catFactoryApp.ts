import {
  CAT_FACTORY_REPOSITORY_MISSING,
  type CatFactoryRepositoryMissing,
  type PullRequestRef,
} from '@sainte-beuve/contracts'
import { UnavailableError, withDeadline } from '@sainte-beuve/kernel'

/**
 * cat-factory's add-service window, opened with the pull request's repository
 * searched for and selected. The format is cat-factory's published deep link
 * (`?addRepo=<owner>/<name>&provider=<host>`); a cat-factory without it still
 * opens the app.
 */
export function addRepositoryUrl(appUrl: string, pullRequest: PullRequestRef): string {
  const url = new URL(`${appUrl.replace(/\/+$/, '')}/`)
  url.searchParams.set('addRepo', `${pullRequest.owner}/${pullRequest.repo}`)
  url.searchParams.set('provider', pullRequest.provider)
  return url.toString()
}

/**
 * The refusal for a repository no cat-factory board has a service for,
 * carrying the link that adds one, so a screen offers the fix rather than
 * describing it. `describe` words it for the action that was refused.
 */
export async function repositoryMissing(
  pullRequest: PullRequestRef,
  appUrl: () => Promise<string>,
  describe: (repository: string) => string,
): Promise<UnavailableError> {
  const details: CatFactoryRepositoryMissing = {
    reason: CAT_FACTORY_REPOSITORY_MISSING,
    repository: `${pullRequest.owner}/${pullRequest.repo}`,
    provider: pullRequest.provider,
    addRepositoryUrl: addRepositoryUrl(await appUrl(), pullRequest),
  }
  return new UnavailableError(describe(details.repository), details)
}

/**
 * Where the instance serves its web app: the org's configured app URL, else
 * what `GET /api/v1/deployment` answers, else the API's own base URL, which is
 * what cat-factory answers itself when no separate app URL is configured.
 */
export async function appUrlOf(access: {
  baseUrl: string
  appUrl?: string | null
  apiKey: string
  fetch?: typeof globalThis.fetch
}): Promise<string> {
  if (access.appUrl != null) return access.appUrl
  try {
    const response = await withDeadline(access.fetch)(`${access.baseUrl}/api/v1/deployment`, {
      headers: { authorization: `Bearer ${access.apiKey}` },
    })
    if (!response.ok) return access.baseUrl
    const body = (await response.json()) as { appUrl?: unknown }
    return typeof body.appUrl === 'string' && body.appUrl !== '' ? body.appUrl : access.baseUrl
  } catch {
    return access.baseUrl
  }
}
