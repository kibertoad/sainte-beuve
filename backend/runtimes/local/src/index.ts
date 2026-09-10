import { type NodeConfig, type RunningServer, loadConfig, start } from '@sainte-beuve/node-server'

/**
 * LOCAL MODE: the whole product on a developer's machine, with nothing registered
 * anywhere.
 *
 * This is not a stripped-down build. It is the same app, the same routes and the
 * same reminder clock the Node facade serves; what local mode changes is the
 * DEFAULTS, so that running it requires no Slack workspace, no GitHub App and no
 * cat-factory account:
 *
 *   - CORS opens to `*`, because the SPA is on a different localhost port.
 *   - cat-factory defaults to `http://localhost:8787`, which is where a local
 *     cat-factory serves. Point `CAT_FACTORY_BASE_URL` at the centralized instance
 *     to use that one instead; the rest of the wiring is identical either way.
 *   - The reminder clock still runs, just faster, so a developer can watch a nudge
 *     fire in a minute rather than in four hours.
 *
 * Everything a hosted deployment configures is still configurable here, and nothing
 * is required. That is the property that matters: a local run exercises the same
 * code paths, so a bug found locally is a bug in production.
 */
export interface LocalOptions {
  /** Override the environment the config is read from. Handy in a test. */
  env?: Record<string, string | undefined>
}

const LOCAL_CAT_FACTORY_BASE_URL = 'http://localhost:8787'

export function localConfig(env: Record<string, string | undefined> = process.env): NodeConfig {
  const config = loadConfig({
    PORT: '8788',
    CORS_ORIGINS: '*',
    LOG_LEVEL: 'debug',
    // Fast enough to watch, slow enough not to spam a local Slack app.
    REMINDER_INTERVAL_MS: '15000',
    CAT_FACTORY_BASE_URL: LOCAL_CAT_FACTORY_BASE_URL,
    ...env,
  })
  return config
}

export async function startLocal(options: LocalOptions = {}): Promise<RunningServer> {
  // Delegated, not reimplemented: local mode IS the Node facade with different
  // defaults, so it must not carry its own copy of the serve/tick/shutdown path
  // for the two to drift apart in.
  return start(localConfig(options.env))
}
