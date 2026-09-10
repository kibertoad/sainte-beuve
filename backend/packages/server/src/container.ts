import type { ReminderPolicy } from '@sainte-beuve/contracts'
import type {
  AiReviewGateway,
  ChatGateway,
  Clock,
  IdGenerator,
  Logger,
  Repositories,
  SecretCipher,
  VcsGateway,
} from '@sainte-beuve/kernel'
import { DEFAULT_REMINDER_POLICY, systemClock, uuidGenerator } from '@sainte-beuve/kernel'
import type { SecretCipherWiring } from './crypto/WebCryptoSecretCipher.js'

/**
 * Everything a request handler is allowed to reach, assembled once per runtime and
 * read off the Hono context. There is no module-level singleton and no service
 * locator: a Worker builds a container per request (bindings only exist there) and
 * the Node facade builds one at boot, and neither knows how the other does it.
 *
 * The three gateways are OPTIONAL because a deployment can legitimately run without
 * them: local mode has no Slack workspace, a read-only trial has no GitHub token,
 * and a deployment that has not connected cat-factory still wants the board. A route
 * that needs one answers 503 naming what is missing, which is a configuration
 * answer an operator can act on.
 */
export interface AppContainer {
  repositories: Repositories
  clock: Clock
  ids: IdGenerator
  logger: Logger
  reminderPolicy: ReminderPolicy
  /** Source of randomness for reviewer selection. Injected so a suite can pin a pick. */
  random: () => number
  chat: ChatGateway | null
  vcs: VcsGateway | null
  aiReview: AiReviewGateway | null
  /**
   * Seals the integration credentials an operator enters in the SPA. Null when
   * the deployment configured no encryption key, and then storing one is refused
   * rather than done in the clear.
   */
  secrets: SecretCipher | null
  /**
   * Why `secrets` is null, when the deployment DID configure a key and this build
   * refused it. Null when nothing was configured, which is what lets the route
   * say "set SETTINGS_ENCRYPTION_KEY" for one and "the key you set was refused,
   * because ..." for the other instead of one message for both.
   */
  secretsRejectedReason: string | null
  /** Slack channel new reviews are announced in. Null when chat is not configured. */
  announcementChannelId: string | null
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
  /** The cipher and the reason there is none, as `secretCipherFrom` reports both. */
  secrets?: SecretCipherWiring | null
  announcementChannelId?: string | null
}

export function createContainer(options: ContainerOptions): AppContainer {
  // Unpacked once rather than twice inline: the cipher and the reason there is
  // none arrive together from `secretCipherFrom` and land on two fields.
  const secrets = options.secrets ?? { cipher: null, rejectedReason: null }
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
    secrets: secrets.cipher,
    secretsRejectedReason: secrets.rejectedReason,
    announcementChannelId: options.announcementChannelId ?? null,
  }
}
