import type { SlackAppManifestResult } from '@sainte-beuve/contracts'
import { slackAppManifest } from '@sainte-beuve/integrations'
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
  if (container.apiBaseUrl === null) return { status: 'unavailable', missing: NO_API_BASE_URL }
  const apiOrigin = configuredOrigin(container.apiBaseUrl)
  if (!apiOrigin.startsWith('https://')) {
    return { status: 'unavailable', missing: notHttps(apiOrigin) }
  }
  const org = await new OrgService(container).current()
  return { status: 'ready', ...slackAppManifest({ apiOrigin, org }) }
}

const NO_API_BASE_URL =
  'Slack posts the /review command and the button presses to this API, and the deployment does ' +
  'not say where it is served: set API_BASE_URL to its public https origin, such as ' +
  'https://api.sainte-beuve.example.com.'

function notHttps(origin: string): string {
  return (
    `Slack only posts to an https URL, and API_BASE_URL is ${origin}: serve the API over https ` +
    '(a tunnel will do on a laptop) and set API_BASE_URL to that origin.'
  )
}
