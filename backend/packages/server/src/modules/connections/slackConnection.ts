import type { SlackConnection } from '@sainte-beuve/contracts'
import { slackWebhookPath } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import {
  announcementChannel,
  resolveChat,
  resolveSlackSigningSecret,
} from '../../integrations/resolve.js'
import { OrgService } from '../orgs/OrgService.js'

/**
 * What the Configuration screen can say about THIS org's Slack workspace.
 *
 * Every field is resolved per org rather than read off the deployment's wiring,
 * and that is the whole of why this is a function rather than four lines in
 * `ConnectionsService.read`. One Slack app serves one tenancy: the secret, the
 * bot token and the announcement channel the deployment configured belong to its
 * own app, which is the default org's, so a second org's screen has to report
 * what IT connected — including that it connected nothing. See
 * `integrations/resolve.ts`.
 *
 * The two halves stay separate because they fail separately. Posting out needs a
 * bot token and trusting what comes back needs the signing secret, and a
 * workspace with one and not the other looks healthy on either flag alone.
 */
export async function slackConnection(container: AppContainer): Promise<SlackConnection> {
  const [chat, signing, org] = await Promise.all([
    resolveChat(container),
    resolveSlackSigningSecret(container),
    // For the Request URL, which is the one field here that differs per tenancy:
    // the slug in it is what places a command on this board and no other.
    new OrgService(container).current(),
  ])
  return {
    ready: chat !== null,
    announcementChannelId: announcementChannel(container),
    interactivityReady: signing !== null,
    requestPath: slackWebhookPath(org.slug),
  }
}
