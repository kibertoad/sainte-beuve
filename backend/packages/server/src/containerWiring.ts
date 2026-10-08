import type { GitHubLabelRules } from '@sainte-beuve/contracts'
import type {
  AppContainer,
  AuthWiring,
  ContainerOptions,
  GitHubWiring,
  SlackWiring,
} from './container.js'

// How `createContainer` reads a facade's options: blank strings as absent, and
// every default in one place.

/**
 * The default reviewer-facing labels. Every rule is a plain string rather than a
 * pattern, because the thing a team has to be able to do is read the label off
 * the Configuration screen and type it onto a pull request.
 */
export const DEFAULT_GITHUB_LABELS: GitHubLabelRules = {
  review: 'needs-review',
  aiReview: 'ai-review',
  skillPrefix: 'skill:',
}

/**
 * A configuration string, or null when there is nothing there.
 *
 * BLANK counts as absent, and this is the one place that decides it for every
 * facade. Both example deployments ship every name with no value
 * (`GITHUB_WEBHOOK_SECRET=`), so a copied file gives `''` rather than
 * `undefined`, and `requireCapability` only refuses `null`: an empty webhook
 * secret would sail past the 503 that names the missing variable and reach Web
 * Crypto, which answers `DataError: Zero-length key is not supported`. GitHub
 * would then be told 500 by a deployment reporting the capability as ready.
 */
export function configured(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim().length === 0 ? null : value
}

/** The same rule for a value that has a default: blank falls back, it does not win. */
function configuredOr(value: string | undefined, fallback: string): string {
  return configured(value) ?? fallback
}

export function githubWiring(options: Partial<GitHubWiring> | undefined): GitHubWiring {
  const labels = options?.labels
  return {
    appSlug: configured(options?.appSlug),
    webhookSecret: configured(options?.webhookSecret),
    botLogin: configured(options?.botLogin),
    labels: {
      review: configuredOr(labels?.review, DEFAULT_GITHUB_LABELS.review),
      aiReview: configuredOr(labels?.aiReview, DEFAULT_GITHUB_LABELS.aiReview),
      skillPrefix: configuredOr(labels?.skillPrefix, DEFAULT_GITHUB_LABELS.skillPrefix),
    },
  }
}

/**
 * A month. Long enough that somebody is not signed out mid-week, short enough
 * that a cookie lifted off a laptop is not a permanent credential.
 */
export const DEFAULT_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

export function authWiring(options: Partial<AuthWiring> | undefined): AuthWiring {
  return {
    // `open` by default, so an existing deployment and local mode keep working
    // and closing the door is a decision somebody made rather than an upgrade
    // that locked them out of their own board.
    mode: options?.mode ?? 'open',
    environmentApiKey: configured(options?.environmentApiKey),
    sessionLifetimeMs: options?.sessionLifetimeMs ?? DEFAULT_SESSION_LIFETIME_MS,
    devMode: options?.devMode ?? false,
  }
}

/** Beside `githubWiring`, and here for the same reason: blank counts as absent. */
export function slackWiring(options: Partial<SlackWiring> | undefined): SlackWiring {
  return {
    signingSecret: configured(options?.signingSecret),
    announcementChannelId: configured(options?.announcementChannelId),
  }
}

/** The outbound gateways, with one a facade left unwired as absent. */
export function outboundGateways(options: ContainerOptions): Pick<AppContainer, 'chat'> {
  return { chat: options.chat ?? null }
}
