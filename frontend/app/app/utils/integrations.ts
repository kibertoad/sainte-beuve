import type {
  CatFactoryConnection,
  Connections,
  SlackConnection,
  VcsAuthMethod,
  VcsConnection,
} from '@sainte-beuve/contracts'
import { vcsDisplayName } from '@sainte-beuve/contracts'

/** What a connection is doing, in one badge. The list and each screen's card show the same one. */
export interface IntegrationBadge {
  color: 'success' | 'info' | 'warning' | 'neutral'
  label: string
}

const NOT_CONFIGURED: IntegrationBadge = { color: 'neutral', label: 'Not configured' }

/**
 * What the deployment is authenticating as, in one line. The order the methods
 * win in is the API's (`vcsAuthMethodSchema`), so this only renders the answer.
 */
const ACTIVE_LABEL: Record<VcsAuthMethod, string> = {
  app: 'Connected as the GitHub App',
  oauth: 'Signed in',
  pat: 'Using a personal access token',
  environment: 'Using the token from the deployment environment',
}

export function vcsBadge(connection: VcsConnection): IntegrationBadge {
  const method = connection.activeMethod
  if (method === null) return { color: 'neutral', label: 'Not connected' }
  // Only a sign-in is a person's, so only a sign-in names one.
  const account =
    method === 'oauth' && connection.account !== null ? ` as ${connection.account}` : ''
  // A method this build does not know falls back to its slug: the API can be newer than the SPA.
  const label = (ACTIVE_LABEL as Partial<Record<string, string>>)[method] ?? method
  return { color: method === 'app' ? 'success' : 'info', label: `${label}${account}` }
}

export function slackBadge(connection: SlackConnection): IntegrationBadge {
  return connection.ready ? { color: 'success', label: 'Delivering' } : NOT_CONFIGURED
}

export function catFactoryBadge(connection: CatFactoryConnection): IntegrationBadge {
  if (connection.aiReviewReady) return { color: 'success', label: 'Ready' }
  if (connection.guidedReviewReady) return { color: 'warning', label: 'Guided review only' }
  return NOT_CONFIGURED
}

/** One row of the Configuration screen's list of integrations. */
export interface IntegrationEntry {
  name: string
  description: string
  icon: string
  to: string
  badge: IntegrationBadge
}

const VCS_ICONS: Record<VcsConnection['provider'], string> = {
  github: 'i-lucide-github',
  gitlab: 'i-lucide-gitlab',
}

/**
 * Every integration this deployment can configure, hosts first because a review
 * starts there. A host the API reports is listed whether or not it is connected.
 */
export function integrationEntries(connections: Connections): IntegrationEntry[] {
  const hosts = connections.vcs.map((connection) => ({
    name: vcsDisplayName(connection.provider),
    description: 'Where a review starts, and where the verdict lands.',
    icon: VCS_ICONS[connection.provider],
    to: `/configuration/${connection.provider}`,
    badge: vcsBadge(connection),
  }))
  return [
    ...hosts,
    {
      name: 'Slack',
      description: 'Announcements, reminder nudges and the slash command.',
      icon: 'i-lucide-slack',
      to: '/configuration/slack',
      badge: slackBadge(connections.slack),
    },
    {
      name: 'cat-factory',
      description: 'The AI reviewer and guided review.',
      icon: 'i-lucide-bot',
      to: '/configuration/cat-factory',
      badge: catFactoryBadge(connections.catFactory),
    },
  ]
}
