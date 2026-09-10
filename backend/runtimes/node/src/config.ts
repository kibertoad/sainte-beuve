/**
 * The Node facade's configuration, read from the process environment.
 *
 * Read ONCE at boot into a typed object rather than reached for with
 * `process.env.X` at the point of use. A missing variable then surfaces as a
 * startup decision ("Slack is not configured") instead of as an undefined deep
 * inside a request, and the set of things a deployment can configure is one list
 * somebody can read.
 */
export interface NodeConfig {
  port: number
  corsOrigins: string[]
  logLevel: string
  /** How often the reminder clock runs, in ms. */
  reminderIntervalMs: number
  catFactory: { baseUrl: string; apiKey: string; serviceId: string; pipelineId?: string } | null
  github: { token: string; baseUrl?: string } | null
  slack: { botToken: string; channelId: string | null } | null
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
    github: env.GITHUB_TOKEN ? { token: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_BASE_URL } : null,
    slack: env.SLACK_BOT_TOKEN
      ? { botToken: env.SLACK_BOT_TOKEN, channelId: env.SLACK_CHANNEL_ID ?? null }
      : null,
    appBaseUrl: env.APP_BASE_URL,
    // `||`, not `??`: an empty variable is one somebody left blank, not one they
    // set, and `.env.example` ships the name with no value for exactly that.
    encryptionKey: env.SETTINGS_ENCRYPTION_KEY || null,
  }
}

function catFactoryFrom(env: Env): NodeConfig['catFactory'] {
  const { CAT_FACTORY_BASE_URL, CAT_FACTORY_API_KEY, CAT_FACTORY_SERVICE_ID } = env
  if (!CAT_FACTORY_BASE_URL || !CAT_FACTORY_API_KEY || !CAT_FACTORY_SERVICE_ID) return null
  return {
    baseUrl: CAT_FACTORY_BASE_URL,
    apiKey: CAT_FACTORY_API_KEY,
    serviceId: CAT_FACTORY_SERVICE_ID,
    pipelineId: env.CAT_FACTORY_PIPELINE_ID,
  }
}
