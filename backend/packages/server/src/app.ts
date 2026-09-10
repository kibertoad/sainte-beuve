import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppContainer } from './container.js'
import type { AppEnv } from './http/env.js'
import { errorBody, handleError } from './http/errors.js'
import { healthController } from './modules/health/HealthController.js'
import { reviewerController } from './modules/reviewers/ReviewerController.js'
import { reviewController } from './modules/reviews/ReviewController.js'
import { webhookController } from './modules/webhooks/WebhookController.js'

/**
 * The Hono app every facade serves. It owns the route table, the error envelope and
 * CORS, and it owns none of the wiring: `resolveContainer` is a callback because a
 * Worker can only build its container once it has the request's `env` bindings,
 * while the Node service builds one at boot. That single seam is what keeps the two
 * facades from growing separate route tables.
 *
 * The API is versioned under `/api/v1` from the first commit. The webhook routes sit
 * OUTSIDE it deliberately: their URLs are registered in GitHub and Slack by hand, so
 * they must survive an API version bump.
 */
export interface AppOptions {
  resolveContainer: (c: { req: Request }) => AppContainer | Promise<AppContainer>
  /** Origins the SPA is served from. `['*']` in local mode; a real list in production. */
  corsOrigins?: string[]
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', cors({ origin: options.corsOrigins ?? ['*'], credentials: true }))

  app.use('*', async (c, next) => {
    c.set('container', await options.resolveContainer({ req: c.req.raw }))
    await next()
  })

  app.route('/', healthController())
  app.route('/', webhookController())
  app.route('/api/v1', reviewerController())
  app.route('/api/v1', reviewController())

  app.notFound((c) => c.json(errorBody('not_found', `No route for ${c.req.path}`), 404))
  app.onError(handleError)

  return app
}
