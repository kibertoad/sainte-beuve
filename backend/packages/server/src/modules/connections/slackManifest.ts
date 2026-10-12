import type { SlackAppManifestResult } from '@sainte-beuve/contracts'
import { slackAppManifest } from '@sainte-beuve/integrations'
import { ConfigurationError } from '@sainte-beuve/kernel'
import { isLoopback } from '../../config/authMode.js'
import type { AppContainer } from '../../container.js'
import { configuredOrigin } from '../../http/callbackOrigin.js'
import { OrgService } from '../orgs/OrgService.js'

/**
 * The Slack app manifest for the org this request is bound to.
 *
 * Built on `API_BASE_URL` and never on the request's own origin: Slack stores the
 * URL and posts to it for months, so a value taken from a `Host` header, or from a
 * loopback address Slack cannot reach, would be a manifest that installs cleanly
 * and then answers nothing.
 */
export async function slackManifest(container: AppContainer): Promise<SlackAppManifestResult> {
  const origin = slackOrigin(container.apiBaseUrl)
  if ('missing' in origin) return { status: 'unavailable', missing: origin.missing }
  const org = await new OrgService(container).current()
  return { status: 'ready', ...slackAppManifest({ apiOrigin: origin.apiOrigin, org }) }
}

/** `API_BASE_URL` as an origin Slack can post to, or the sentence saying why it is not one. */
function slackOrigin(apiBaseUrl: string | null): { apiOrigin: string } | { missing: string } {
  if (apiBaseUrl === null) return { missing: NO_API_BASE_URL }
  let url: URL
  try {
    url = new URL(configuredOrigin(apiBaseUrl))
  } catch (error) {
    if (error instanceof ConfigurationError) return { missing: error.message }
    throw error
  }
  if (url.protocol !== 'https:' || isLoopback(url.hostname)) {
    return { missing: notReachable(url.origin) }
  }
  return { apiOrigin: url.origin }
}

const NO_API_BASE_URL =
  'Slack posts the /review command and the button presses to this API, and the deployment does ' +
  'not say where it is served: set API_BASE_URL to its public https origin, such as ' +
  'https://api.sainte-beuve.example.com.'

function notReachable(origin: string): string {
  return (
    `Slack only posts to a public https URL, and API_BASE_URL is ${origin}: serve the API ` +
    'over https on a public host (a tunnel will do on a laptop) and set API_BASE_URL to that ' +
    'origin.'
  )
}
