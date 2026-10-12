import type { VcsConnection, VcsProvider } from '@sainte-beuve/contracts'
import { GITHUB_WEBHOOK_PATH, gitlabWebhookPath } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import {
  gitlabBotUsername,
  resolveGitLabWebhookSecret,
  type StoredAccount,
} from '../../integrations/resolve.js'
import { OrgService } from '../orgs/OrgService.js'

type VcsInbound = Pick<
  VcsConnection,
  'inboundIntake' | 'webhooksReady' | 'webhookPath' | 'botLogin'
>

/**
 * What a host's webhook intake needs from the Configuration screen.
 *
 * The two hosts answer from different places. GitHub's intake is the
 * deployment's: one App, one `GITHUB_WEBHOOK_SECRET`, one URL, placed by the
 * project registry. GitLab's is the org's: the secret is stored per org, the URL
 * carries the org's slug, and the bot is the account of the org's own stored
 * credential, which is `account` here, when GitLab marks it as a bot.
 */
export async function vcsInbound(
  container: AppContainer,
  provider: VcsProvider,
  account: StoredAccount | null,
): Promise<VcsInbound> {
  if (provider === 'github') {
    return {
      inboundIntake: true,
      webhooksReady: container.github.webhookSecret !== null,
      webhookPath: GITHUB_WEBHOOK_PATH,
      botLogin: container.github.botLogin,
    }
  }
  const [secret, org] = await Promise.all([
    resolveGitLabWebhookSecret(container),
    new OrgService(container).current(),
  ])
  return {
    inboundIntake: true,
    webhooksReady: secret !== null,
    webhookPath: gitlabWebhookPath(org.slug),
    botLogin: gitlabBotUsername(account),
  }
}
