import type { PullRequestRef } from '@sainte-beuve/contracts'
import { withDeadline } from '@sainte-beuve/kernel'

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
 * Where the instance serves its web app, from `GET /api/v1/deployment`. Falls
 * back to the API's own base URL, which is what cat-factory answers itself when
 * no separate app URL is configured, and what a release without the read needs.
 */
export async function appUrlOf(access: {
  baseUrl: string
  apiKey: string
  fetch?: typeof globalThis.fetch
}): Promise<string> {
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
