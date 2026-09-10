import { serve } from '@hono/node-server'
import { createApp, runReminderTick } from '@sainte-beuve/server'
import { type NodeConfig, loadConfig } from './config.js'
import { buildContainer } from './container.js'

/**
 * The Node.js facade: the same Hono app the Worker serves, over
 * `@hono/node-server`, with the reminder clock on an interval instead of a cron
 * trigger.
 *
 * A deployment calls `start()` and supplies configuration through the environment;
 * see deploy/node.
 */
export interface RunningServer {
  port: number
  close: () => Promise<void>
}

export async function start(config: NodeConfig = loadConfig()): Promise<RunningServer> {
  const container = buildContainer(config)
  const app = createApp({
    resolveContainer: () => container,
    corsOrigins: config.corsOrigins,
  })

  const server = serve({ fetch: app.fetch, port: config.port })
  const timer = setInterval(() => {
    void runReminderTick(container).catch((err: unknown) => {
      container.logger.error({ err }, 'reminder tick failed')
    })
  }, config.reminderIntervalMs)
  // Do not hold the process open for the clock alone: a shutdown should be decided
  // by the HTTP server closing, not by a timer nobody is waiting on.
  timer.unref()

  container.logger.info({ port: config.port }, 'sainte-beuve node server listening')
  return {
    port: config.port,
    close: async () => {
      clearInterval(timer)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

export { type NodeConfig, loadConfig } from './config.js'
export { buildContainer } from './container.js'
