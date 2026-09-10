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

/**
 * GitLab. One base URL configures the whole connection: an install serves its
 * API and its OAuth endpoints under the same root, unlike GitHub. There is no
 * App equivalent, so a group access token is a pasted token like any other.
 */
export interface GitLabConfig {
  /** The install's root. Undefined means gitlab.com. */
  baseUrl: string | undefined
  token: string | null
  oauth: { clientId: string; clientSecret: string; scope?: string } | null
}

export interface NodeConfig {
  port: number
  /**
   * The Postgres the board and the workspace live in. Null leaves the process
   * on the in-memory store, which is right for a laptop and wrong for anything
   * shared; `/health` reports which one is in force.
   */
  databaseUrl: string | null
  /** Pool ceiling. Undefined leaves it to node-postgres. */
  databaseMaxConnections: number | undefined
  /**
   * Whether to bring the schema up to date at boot. On by default, because a
   * rolling deploy otherwise serves requests against a schema one release
   * behind. Turn it off in a deployment that runs the migrations as a step of
   * its own, against `POSTGRES_MIGRATIONS_DIR`.
   */
  databaseMigrate: boolean
  corsOrigins: string[]
  logLevel: string
  /** How often the reminder clock runs, in ms. */
  reminderIntervalMs: number
  catFactory: { baseUrl: string; serviceId: string; pipelineId?: string } | null
  /** The cat-factory key from the environment, when there is one. */
  catFactoryApiKey: string | null
  github: GitHubConfig
  gitlab: GitLabConfig
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

/** An optional numeric setting: absent and unparseable both mean "leave the default". */
function optionalIntFrom(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isNaN(parsed) ? undefined : parsed
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
    databaseUrl: env.DATABASE_URL || null,
    databaseMaxConnections: optionalIntFrom(env.DATABASE_MAX_CONNECTIONS),
    // `!== 'false'`, so the durable path is what an operator gets by leaving
    // the variable out, and turning migrations off is a decision somebody
    // typed.
    databaseMigrate: (env.DATABASE_MIGRATE ?? 'true') !== 'false',
    corsOrigins: listFrom(env.CORS_ORIGINS, ['*']),
    logLevel: env.LOG_LEVEL ?? 'info',
    reminderIntervalMs: intFrom(env.REMINDER_INTERVAL_MS, 60_000),
    catFactory: catFactoryFrom(env),
    // `||` throughout, not `??`: an empty variable is one somebody left blank,
    // not one they set, and `.env.example` ships every name with no value.
    catFactoryApiKey: env.CAT_FACTORY_API_KEY || null,
    github: githubFrom(env),
    gitlab: gitlabFrom(env),
    slack: {
      botToken: env.SLACK_BOT_TOKEN || null,
      signingSecret: env.SLACK_SIGNING_SECRET || null,
      channelId: env.SLACK_CHANNEL_ID || null,
    },
    appBaseUrl: env.APP_BASE_URL || undefined,
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
    pipelineId: env.CAT_FACTORY_PIPELINE_ID || undefined,
  }
}

/**
 * One host's OAuth client, or null when the pair that makes one is not there.
 * Both hosts' sign-ins are configured the same way, so both read it here: a
 * client id with no secret is half a flow, and offering it would be a button
 * that fails at the exchange.
 */
function oauthFrom(client: {
  clientId: string | undefined
  clientSecret: string | undefined
  scope: string | undefined
}): GitHubConfig['oauth'] {
  const { clientId, clientSecret } = client
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, scope: client.scope || undefined }
}

function gitlabFrom(env: Env): GitLabConfig {
  return {
    // `|| undefined`, like every other read here: `GITLAB_BASE_URL=` in a
    // copied `.env.example` is a variable nobody set, and `''` as the base
    // builds every GitLab path relative instead of against gitlab.com.
    baseUrl: env.GITLAB_BASE_URL || undefined,
    token: env.GITLAB_TOKEN || null,
    oauth: oauthFrom({
      clientId: env.GITLAB_OAUTH_CLIENT_ID,
      clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET,
      scope: env.GITLAB_OAUTH_SCOPE,
    }),
  }
}

/** The reviewer-facing labels, each falling back to the default when unset. */
function labelsFrom(env: Env): GitHubLabelRules {
  return {
    review: env.GITHUB_LABEL_REVIEW || DEFAULT_GITHUB_LABELS.review,
    aiReview: env.GITHUB_LABEL_AI_REVIEW || DEFAULT_GITHUB_LABELS.aiReview,
    skillPrefix: env.GITHUB_LABEL_SKILL_PREFIX || DEFAULT_GITHUB_LABELS.skillPrefix,
  }
}

function githubFrom(env: Env): GitHubConfig {
  return {
    token: env.GITHUB_TOKEN || null,
    baseUrl: env.GITHUB_API_BASE_URL || undefined,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET || null,
    app:
      env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY
        ? { appId: env.GITHUB_APP_ID, privateKeyPem: env.GITHUB_APP_PRIVATE_KEY }
        : null,
    appSlug: env.GITHUB_APP_SLUG || null,
    oauth: oauthFrom({
      clientId: env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
      scope: env.GITHUB_OAUTH_SCOPE,
    }),
    botLogin: env.GITHUB_BOT_LOGIN || null,
    labels: labelsFrom(env),
  }
}
