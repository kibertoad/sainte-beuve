import {
  type NodeConfig,
  type RunningServer,
  buildContainer,
  loadConfig,
} from '@sainte-beuve/node-server'
import { createApp, runReminderTick } from '@sainte-beuve/server'
import { serve } from '@hono/node-server'

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
  const config = localConfig(options.env)
  const container = buildContainer(config)
  const app = createApp({ resolveContainer: () => container, corsOrigins: config.corsOrigins })

  const server = serve({ fetch: app.fetch, port: config.port })
  const timer = setInterval(() => {
    void runReminderTick(container).catch((err: unknown) => {
      container.logger.error({ err }, 'reminder tick failed')
    })
  }, config.reminderIntervalMs)
  timer.unref()

  container.logger.info(
    {
      port: config.port,
      catFactory: config.catFactory === null ? 'not configured' : config.catFactory.baseUrl,
      slack: config.slack === null ? 'not configured' : 'configured',
      github: config.github === null ? 'not configured' : 'configured',
    },
    'sainte-beuve local mode ready',
  )
  return {
    port: config.port,
    close: async () => {
      clearInterval(timer)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
