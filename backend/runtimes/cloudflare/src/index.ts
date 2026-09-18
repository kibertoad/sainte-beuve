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

/**
 * Built once per isolate, not once per request. The app is the route table, four
 * sub-routers and a contract validator per route, all of which are the same for
 * every request; the CONTAINER is the per-request part, and it is a callback for
 * exactly that reason. Rebuilding the app on each invocation would compile the
 * router again on a runtime billed by CPU time.
 */
const app = createApp({
  // The request's `waitUntil` goes down with the bindings, and it is what makes
  // the attention fan-out reliable rather than occasional: a publish follows a
  // write that already succeeded, so it must not be awaited, and this runtime
  // cancels unawaited I/O the moment the response is returned.
  resolveContainer: (scope) => containerFor(scope.env as WorkerEnv, scope.waitUntil),
  corsOrigins: (scope) => corsOriginsFor(scope.env as WorkerEnv),
})

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx)
  },

  async scheduled(
    _event: ScheduledController,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const container = containerFor(env, (work) => {
      ctx.waitUntil(work)
    })
    // `waitUntil` so a slow Slack call cannot make the cron invocation time out
    // and be retried with half its batch already delivered. The rejection handler
    // matches the Node facade's: a tick that throws inside `waitUntil` is
    // otherwise an uncaught exception with nothing in it to act on.
    ctx.waitUntil(
      runReminderTick(container).catch((err: unknown) => {
        container.logger.error({ err }, 'reminder tick failed')
      }),
    )
  },
}

export { containerFor, corsOriginsFor } from './container.js'
export type { WorkerEnv } from './env.js'
/**
 * The attention hub, exported so wrangler can find the class its `ATTENTION`
 * binding names. A deployment re-exports it beside `default`; a deployment that
 * does not bind it at all still boots, on the in-isolate fan-out.
 */
export { AttentionHub } from './realtime/AttentionHub.js'
