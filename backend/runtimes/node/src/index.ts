import { serve } from '@hono/node-server'
import type { Logger } from '@sainte-beuve/kernel'
import { createApp, runReminderTick } from '@sainte-beuve/server'
import { pino } from 'pino'
import { type NodeConfig, loadConfig } from './config.js'
import { buildContainer } from './container.js'
import { openStore } from './persistence.js'

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
  const logger: Logger = pino({ level: config.logLevel })
  // Before the server, because opening the store runs the migrations: a process
  // that accepted requests first would answer them against a schema it is still
  // changing.
  const store = await openStore(config, logger)
  const container = buildContainer(config, store, logger)
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

  // One line naming every optional capability, because "which integrations did
  // this process actually wire?" is the first question a deploy raises and the
  // answer is otherwise spread across `/health` and three screens. GitHub reports
  // the METHODS it can offer rather than a boolean: a deployment with an App and
  // no token is configured, and a boolean would call it unconfigured.
  container.logger.info(
    {
      port: config.port,
      persistence: store.kind,
      catFactory: config.catFactory === null ? 'not configured' : config.catFactory.baseUrl,
      slack: slackSummary(config),
      github: githubSummary(config),
      gitlab: gitlabSummary(config),
      secrets: config.encryptionKey === null ? 'not configured' : 'configured',
    },
    'sainte-beuve server listening',
  )
  return {
    port: config.port,
    close: async () => {
      clearInterval(timer)
      await new Promise<void>((resolve) => server.close(() => resolve()))
      // After the server, so a request in flight still has its connections.
      await store.close()
    },
  }
}

/** Which GitHub credentials this process can offer, in the order they win. */
function githubSummary(config: NodeConfig): string {
  const offered = [
    config.github.app === null ? null : 'app',
    config.github.oauth === null ? null : 'sign-in',
    config.github.token === null ? null : 'token',
    config.github.webhookSecret === null ? null : 'webhooks',
  ].filter((entry): entry is string => entry !== null)
  return offered.length === 0 ? 'not configured' : offered.join(', ')
}

/** Which GitLab credentials this process can offer. No App: GitLab has none. */
function gitlabSummary(config: NodeConfig): string {
  const offered = [
    config.gitlab.oauth === null ? null : 'sign-in',
    config.gitlab.token === null ? null : 'token',
  ].filter((entry): entry is string => entry !== null)
  return offered.length === 0 ? 'not configured' : offered.join(', ')
}

function slackSummary(config: NodeConfig): string {
  const offered = [
    config.slack.botToken === null ? null : 'bot token',
    config.slack.signingSecret === null ? null : 'interactivity',
    config.slack.channelId === null ? null : 'announcements',
  ].filter((entry): entry is string => entry !== null)
  return offered.length === 0 ? 'not configured' : offered.join(', ')
}

export { type GitHubConfig, type GitLabConfig, type NodeConfig, loadConfig } from './config.js'
export { buildContainer } from './container.js'
export { type NodeStore, openStore } from './persistence.js'
