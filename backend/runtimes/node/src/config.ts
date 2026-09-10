import type { GitHubLabelRules } from '@sainte-beuve/contracts'
import { DEFAULT_GITHUB_LABELS } from '@sainte-beuve/server'

/**
 * The Node facade's configuration, read from the process environment.
 *
 * Read ONCE at boot into a typed object rather than reached for with
 * `process.env.X` at the point of use. A missing variable then surfaces as a
 * startup decision ("Slack is not configured") instead of as an undefined deep
 * inside a request, and the set of things a deployment can configure is one list
 * somebody can read.
 *
 * It mirrors `WorkerEnv` name for name, which is the property that matters: a
 * variable that exists on one runtime and not the other is a capability that
 * works on one deployment and not the other.
 */

/**
 * GitHub, in the three shapes a deployment can be connected in. They are not
 * alternatives to pick between at boot: whichever are configured are OFFERED,
 * and the strongest present is what calls are made with (see
 * `githubAuthMethodSchema` in @sainte-beuve/contracts).
 */
export interface GitHubConfig {
  /** A personal access token, for a deployment that wants no app registration. */
  token: string | null
  /** GitHub Enterprise Server's API base. */
  baseUrl: string | undefined
  /** The shared secret inbound deliveries are signed with. */
  webhookSecret: string | null
  /**
   * The App. The id signs the JWT and the slug addresses the install page: both
   * are needed to offer an install. The key must be PKCS#8; GitHub issues
   * PKCS#1, so convert it once with `openssl pkcs8 -topk8 -nocrypt`.
   */
  app: { appId: string; privateKeyPem: string } | null
  appSlug: string | null
  /** The OAuth client behind "Sign in with GitHub". A GitHub App's own client works. */
  oauth: { clientId: string; clientSecret: string; scope?: string } | null
  /** The login the bot answers to when @-mentioned in a pull-request comment. */
  botLogin: string | null
  labels: GitHubLabelRules
}

export interface NodeConfig {
  port: number
  corsOrigins: string[]
  logLevel: string
  /** How often the reminder clock runs, in ms. */
  reminderIntervalMs: number
  catFactory: { baseUrl: string; serviceId: string; pipelineId?: string } | null
  /** The cat-factory key from the environment, when there is one. */
  catFactoryApiKey: string | null
  github: GitHubConfig
  slack: { botToken: string | null; signingSecret: string | null; channelId: string | null }
  appBaseUrl: string | undefined
  /**
   * Master key for the credentials entered on the Configuration screen, base64,
   * 32 bytes or more (`openssl rand -base64 32`). Null leaves the capability off.
   */
  encryptionKey: string | null
}

type Env = Record<string, string | undefined>

function intFrom(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function listFrom(value: string | undefined, fallback: string[]): string[] {
  const parts = (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.length === 0 ? fallback : parts
}

export function loadConfig(env: Env = process.env): NodeConfig {
  return {
    port: intFrom(env.PORT, 8788),
    corsOrigins: listFrom(env.CORS_ORIGINS, ['*']),
    logLevel: env.LOG_LEVEL ?? 'info',
    reminderIntervalMs: intFrom(env.REMINDER_INTERVAL_MS, 60_000),
    catFactory: catFactoryFrom(env),
    // `||` throughout, not `??`: an empty variable is one somebody left blank,
    // not one they set, and `.env.example` ships every name with no value.
    catFactoryApiKey: env.CAT_FACTORY_API_KEY || null,
    github: githubFrom(env),
    slack: {
      botToken: env.SLACK_BOT_TOKEN || null,
      signingSecret: env.SLACK_SIGNING_SECRET || null,
      channelId: env.SLACK_CHANNEL_ID || null,
    },
    appBaseUrl: env.APP_BASE_URL,
    encryptionKey: env.SETTINGS_ENCRYPTION_KEY || null,
  }
}

/**
 * cat-factory's non-credential half. Separate from the API key because the key
 * can also arrive from the Configuration screen, and a deployment that supplies
 * the base URL and the service id here can be finished from the SPA.
 */
function catFactoryFrom(env: Env): NodeConfig['catFactory'] {
  const { CAT_FACTORY_BASE_URL, CAT_FACTORY_SERVICE_ID } = env
  if (!CAT_FACTORY_BASE_URL || !CAT_FACTORY_SERVICE_ID) return null
  return {
    baseUrl: CAT_FACTORY_BASE_URL,
    serviceId: CAT_FACTORY_SERVICE_ID,
    pipelineId: env.CAT_FACTORY_PIPELINE_ID,
  }
}

function githubFrom(env: Env): GitHubConfig {
  return {
    token: env.GITHUB_TOKEN || null,
    baseUrl: env.GITHUB_API_BASE_URL,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET || null,
    app:
      env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY
        ? { appId: env.GITHUB_APP_ID, privateKeyPem: env.GITHUB_APP_PRIVATE_KEY }
        : null,
    appSlug: env.GITHUB_APP_SLUG || null,
    oauth:
      env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET
        ? {
            clientId: env.GITHUB_OAUTH_CLIENT_ID,
            clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
            scope: env.GITHUB_OAUTH_SCOPE,
          }
        : null,
    botLogin: env.GITHUB_BOT_LOGIN || null,
    labels: {
      review: env.GITHUB_LABEL_REVIEW || DEFAULT_GITHUB_LABELS.review,
      aiReview: env.GITHUB_LABEL_AI_REVIEW || DEFAULT_GITHUB_LABELS.aiReview,
      skillPrefix: env.GITHUB_LABEL_SKILL_PREFIX || DEFAULT_GITHUB_LABELS.skillPrefix,
    },
  }
}
