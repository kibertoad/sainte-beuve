import type {
  AuthMode,
  GitHubLabelRules,
  ReminderPolicy,
  VcsProvider,
} from '@sainte-beuve/contracts'
import type {
  AiReviewGateway,
  AttentionBus,
  ChatGateway,
  Clock,
  GatewayFactory,
  IdGenerator,
  Logger,
  PersistenceKind,
  Repositories,
  SecretCipher,
  StateSigner,
  VcsGateway,
} from '@sainte-beuve/kernel'
import { DEFAULT_REMINDER_POLICY, systemClock, uuidGenerator } from '@sainte-beuve/kernel'
import type { SecretsWiring } from './crypto/WebCryptoSecretCipher.js'
import { InMemoryAttentionBus } from './realtime/InMemoryAttentionBus.js'

/** The environment's own gateway per host. Absent for a host nothing configured. */
export type EnvironmentVcsGateways = Record<VcsProvider, VcsGateway | null>

/** Nothing configured for either host, which is what a fresh deployment has. */
export const NO_VCS_GATEWAYS: EnvironmentVcsGateways = { github: null, gitlab: null }

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

/**
 * How much this deployment insists on knowing who is calling.
 *
 * `mode` is a decision somebody typed rather than something derived from what
 * else is configured, for the reason `authModeSchema` gives: both derivations
 * fail in the direction that hurts. It defaults to `open`, which is what every
 * deployment ran before sessions existed and what local mode still runs, and
 * `/health` reports it so the answer is legible from outside the process.
 */
export interface AuthWiring {
  mode: AuthMode
  /**
   * The deployment's OWN API key, from its environment. The same idea as
   * `GITHUB_TOKEN` beside a stored GitHub credential: a machine credential the
   * process holds rather than one somebody minted in the SPA.
   *
   * It exists to answer the bootstrap. A deployment that comes up in `required`
   * mode has no sessions and no minted keys, so the route that mints the first
   * key would be the route that cannot be reached; this is the way in. It is
   * matched BEFORE the store, so it keeps working while the database is being
   * restored.
   */
  environmentApiKey: string | null
  /**
   * How long a session lasts, absolutely. Configurable because the right answer
   * is a deployment's policy rather than ours, and injected because the suites
   * have to be able to walk past an expiry without waiting a month.
   */
  sessionLifetimeMs: number
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
  /**
   * Which store those repositories are, for `/health` to report. The facade
   * knows and nothing below it does, which is the point: a service that
   * branched on the store would be a service the conformance suite no longer
   * covers.
   */
  persistence: PersistenceKind
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
  /**
   * The environment's own source-control credential per host, which every
   * stored credential takes precedence over. A record rather than one gateway,
   * because a deployment can hold `GITHUB_TOKEN` and `GITLAB_TOKEN` at once and
   * a workspace sweeping both has to reach each with its own.
   */
  vcs: EnvironmentVcsGateways
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
  /**
   * Fans attention events out to the pages that are connected right now. Never
   * null: the workspace's REST inbox is what makes the feature correct, and the
   * bus is the optimisation on top, so a facade that forgets to wire one gets
   * an in-process bus rather than a stream that silently delivers nothing.
   */
  bus: AttentionBus
  github: GitHubWiring
  slack: SlackWiring
  auth: AuthWiring
  /**
   * Where the SPA is served from, so a connect callback can send the browser back
   * to it and a chat message can link to a review. Null when the deployment did
   * not say, and then a callback answers with a plain page instead of redirecting.
   */
  appBaseUrl: string | null
}

export interface ContainerOptions {
  repositories: Repositories
  /** Defaults to `memory`, which is what a facade that wired no durable store has. */
  persistence?: PersistenceKind
  logger: Logger
  clock?: Clock
  ids?: IdGenerator
  reminderPolicy?: ReminderPolicy
  random?: () => number
  chat?: ChatGateway | null
  vcs?: Partial<EnvironmentVcsGateways> | null
  aiReview?: AiReviewGateway | null
  bus?: AttentionBus
  gateways?: GatewayFactory | null
  /** The cipher, the state signer, and the reason there is neither, as `secretsFrom` reports them. */
  secrets?: SecretsWiring | null
  github?: Partial<GitHubWiring>
  slack?: Partial<SlackWiring>
  auth?: Partial<AuthWiring>
  appBaseUrl?: string | null
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
function configured(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim().length === 0 ? null : value
}

/** The same rule for a value that has a default: blank falls back, it does not win. */
function configuredOr(value: string | undefined, fallback: string): string {
  return configured(value) ?? fallback
}

function githubWiring(options: Partial<GitHubWiring> | undefined): GitHubWiring {
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

function authWiring(options: Partial<AuthWiring> | undefined): AuthWiring {
  return {
    // `open` by default, so an existing deployment and local mode keep working
    // and closing the door is a decision somebody made rather than an upgrade
    // that locked them out of their own board.
    mode: options?.mode ?? 'open',
    environmentApiKey: configured(options?.environmentApiKey),
    sessionLifetimeMs: options?.sessionLifetimeMs ?? DEFAULT_SESSION_LIFETIME_MS,
  }
}

/** Beside `githubWiring`, and here for the same reason: blank counts as absent. */
function slackWiring(options: Partial<SlackWiring> | undefined): SlackWiring {
  return {
    signingSecret: configured(options?.signingSecret),
    announcementChannelId: configured(options?.announcementChannelId),
  }
}

export function createContainer(options: ContainerOptions): AppContainer {
  // Unpacked once rather than three times inline: the two capabilities and the
  // reason there are none arrive together from `secretsFrom`.
  const secrets = options.secrets ?? { cipher: null, states: null, rejectedReason: null }
  return {
    repositories: options.repositories,
    persistence: options.persistence ?? 'memory',
    logger: options.logger,
    clock: options.clock ?? systemClock,
    ids: options.ids ?? uuidGenerator,
    reminderPolicy: options.reminderPolicy ?? DEFAULT_REMINDER_POLICY,
    random: options.random ?? Math.random,
    chat: options.chat ?? null,
    vcs: { ...NO_VCS_GATEWAYS, ...options.vcs },
    aiReview: options.aiReview ?? null,
    // A fresh bus per container is right for a facade that builds one at boot
    // and wrong for one that builds a container per request, which is why the
    // Worker holds its own at module level and passes it in here.
    bus: options.bus ?? new InMemoryAttentionBus(),
    gateways: options.gateways ?? null,
    secrets: secrets.cipher,
    states: secrets.states,
    secretsRejectedReason: secrets.rejectedReason,
    github: githubWiring(options.github),
    slack: slackWiring(options.slack),
    auth: authWiring(options.auth),
    appBaseUrl: configured(options.appBaseUrl),
  }
}
