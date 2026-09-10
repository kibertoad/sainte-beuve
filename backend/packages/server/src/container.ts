import type { GitHubLabelRules, ReminderPolicy } from '@sainte-beuve/contracts'
import type {
  AiReviewGateway,
  ChatGateway,
  Clock,
  GatewayFactory,
  IdGenerator,
  Logger,
  Repositories,
  SecretCipher,
  StateSigner,
  VcsGateway,
} from '@sainte-beuve/kernel'
import { DEFAULT_REMINDER_POLICY, systemClock, uuidGenerator } from '@sainte-beuve/kernel'
import type { SecretsWiring } from './crypto/WebCryptoSecretCipher.js'

/**
 * Everything a request handler is allowed to reach, assembled once per runtime and
 * read off the Hono context. There is no module-level singleton and no service
 * locator: a Worker builds a container per request (bindings only exist there) and
 * the Node facade builds one at boot, and neither knows how the other does it.
 *
 * The gateways are OPTIONAL because a deployment can legitimately run without
 * them: local mode has no Slack workspace, a read-only trial has no GitHub
 * credential, and a deployment that has not connected cat-factory still wants the
 * board. A route that needs one answers 503 naming what is missing, which is a
 * configuration answer an operator can act on.
 */

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

/** GitHub deployment configuration: everything about the connection that is not a credential. */
export interface GitHubWiring {
  /**
   * The App's slug, which is what its public install page is addressed by (the
   * App ID signs the JWT; the two are different strings for the same App). Null
   * leaves the install button off, because there is no URL to send anybody to.
   */
  appSlug: string | null
  /**
   * The shared secret an inbound delivery's signature is checked against. Null
   * leaves the webhook route refusing every delivery: an unsigned event is a
   * stranger's POST, and acting on one would let anybody close a review.
   */
  webhookSecret: string | null
  /** The login the bot answers to when it is @-mentioned in a comment. */
  botLogin: string | null
  labels: GitHubLabelRules
}

/** Slack deployment configuration, beside the bot token that is a credential. */
export interface SlackWiring {
  /**
   * The secret Slack signs its requests with. Null leaves the slash command and
   * the message buttons refusing, for the same reason the GitHub webhook does.
   */
  signingSecret: string | null
  /** Channel new review requests are announced in. Null leaves announcements off. */
  announcementChannelId: string | null
}

export interface AppContainer {
  repositories: Repositories
  clock: Clock
  ids: IdGenerator
  logger: Logger
  reminderPolicy: ReminderPolicy
  /** Source of randomness for reviewer selection. Injected so a suite can pin a pick. */
  random: () => number
  /**
   * The gateways this deployment's own configuration built, which is the
   * fallback a stored credential takes precedence over. See
   * `integrations/resolve.ts` for the order and why it is that way round.
   */
  chat: ChatGateway | null
  vcs: VcsGateway | null
  aiReview: AiReviewGateway | null
  /**
   * Builds a gateway from a stored credential, which is the seam that lets a
   * token entered on the Configuration screen take effect without a redeploy
   * (see `GatewayFactory` in @sainte-beuve/kernel). Null on a facade that wired
   * no adapters, and then only the deployment's own gateways are reachable.
   */
  gateways: GatewayFactory | null
  /**
   * Seals the integration credentials an operator enters in the SPA. Null when
   * the deployment configured no encryption key, and then storing one is refused
   * rather than done in the clear.
   */
  secrets: SecretCipher | null
  /** Signs the state carried through a connect round trip. Null exactly when `secrets` is. */
  states: StateSigner | null
  /**
   * Why `secrets` is null, when the deployment DID configure a key and this build
   * refused it. Null when nothing was configured, which is what lets the route
   * say "set SETTINGS_ENCRYPTION_KEY" for one and "the key you set was refused,
   * because ..." for the other instead of one message for both.
   */
  secretsRejectedReason: string | null
  github: GitHubWiring
  slack: SlackWiring
  /**
   * Where the SPA is served from, so a connect callback can send the browser back
   * to it and a chat message can link to a review. Null when the deployment did
   * not say, and then a callback answers with a plain page instead of redirecting.
   */
  appBaseUrl: string | null
}

export interface ContainerOptions {
  repositories: Repositories
  logger: Logger
  clock?: Clock
  ids?: IdGenerator
  reminderPolicy?: ReminderPolicy
  random?: () => number
  chat?: ChatGateway | null
  vcs?: VcsGateway | null
  aiReview?: AiReviewGateway | null
  gateways?: GatewayFactory | null
  /** The cipher, the state signer, and the reason there is neither, as `secretsFrom` reports them. */
  secrets?: SecretsWiring | null
  github?: Partial<GitHubWiring>
  slack?: Partial<SlackWiring>
  appBaseUrl?: string | null
}

export function createContainer(options: ContainerOptions): AppContainer {
  // Unpacked once rather than three times inline: the two capabilities and the
  // reason there are none arrive together from `secretsFrom`.
  const secrets = options.secrets ?? { cipher: null, states: null, rejectedReason: null }
  return {
    repositories: options.repositories,
    logger: options.logger,
    clock: options.clock ?? systemClock,
    ids: options.ids ?? uuidGenerator,
    reminderPolicy: options.reminderPolicy ?? DEFAULT_REMINDER_POLICY,
    random: options.random ?? Math.random,
    chat: options.chat ?? null,
    vcs: options.vcs ?? null,
    aiReview: options.aiReview ?? null,
    gateways: options.gateways ?? null,
    secrets: secrets.cipher,
    states: secrets.states,
    secretsRejectedReason: secrets.rejectedReason,
    github: {
      appSlug: null,
      webhookSecret: null,
      botLogin: null,
      labels: DEFAULT_GITHUB_LABELS,
      ...options.github,
    },
    slack: { signingSecret: null, announcementChannelId: null, ...options.slack },
    appBaseUrl: options.appBaseUrl ?? null,
  }
}
