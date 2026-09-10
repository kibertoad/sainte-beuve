import { createApp, runReminderTick } from '@sainte-beuve/server'
import { containerFor, corsOriginsFor } from './container.js'
import type { WorkerEnv } from './env.js'

/**
 * The Cloudflare Worker facade.
 *
 * `fetch` serves the shared Hono app; `scheduled` drives the reminder clock from a
 * cron trigger. The two handlers share one container factory, so a reminder sent by
 * the cron and a reminder sent by a request go through exactly the same code.
 *
 * A deployment re-exports `default` from here and supplies its own wrangler.toml;
 * see deploy/backend.
 */
export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({
      resolveContainer: () => containerFor(env),
      corsOrigins: corsOriginsFor(env),
    })
    return app.fetch(request, env, ctx)
  },

  async scheduled(
    _event: ScheduledController,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    // `waitUntil` so a slow Slack call cannot make the cron invocation time out
    // and be retried with half its batch already delivered.
    ctx.waitUntil(runReminderTick(containerFor(env)))
  },
}

export { containerFor, corsOriginsFor } from './container.js'
export type { WorkerEnv } from './env.js'
