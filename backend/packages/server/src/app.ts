import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppContainer } from './container.js'
import type { AppEnv } from './http/env.js'
import { errorBody, handleError } from './http/errors.js'
import { allowedOrigin, intendedMethod, WILDCARD, writeOriginGuard } from './http/origins.js'
import { attentionController } from './modules/attention/AttentionController.js'
import { authController } from './modules/auth/AuthController.js'
import { authentication } from './modules/auth/principal.js'
import { connectController } from './modules/connections/ConnectController.js'
import { connectionsController } from './modules/connections/ConnectionsController.js'
import { healthController } from './modules/health/HealthController.js'
import { projectController } from './modules/projects/ProjectController.js'
import { reviewerController } from './modules/reviewers/ReviewerController.js'
import { aiReviewController } from './modules/reviews/AiReviewController.js'
import { reviewController } from './modules/reviews/ReviewController.js'
import { settingsController } from './modules/settings/SettingsController.js'
import { webhookController } from './modules/webhooks/WebhookController.js'
import { workspaceController } from './modules/workspace/WorkspaceController.js'

/**
 * The Hono app every facade serves. It owns the route table, the error envelope and
 * CORS, and it owns none of the wiring: the options are callbacks because a Worker
 * only learns its configuration once a request hands it the bindings, while the
 * Node service reads it at boot. That single seam is what keeps the two facades
 * from growing separate route tables, and it is why a Worker can build this app
 * ONCE per isolate rather than once per request.
 *
 * The API is versioned under `/api/v1` from the first commit. Two groups of routes
 * sit OUTSIDE it deliberately, and for the same reason: the webhook paths are
 * registered in a GitHub App and a Slack app by hand, and the connect callbacks
 * are typed into a GitHub App's settings. Both have to survive an API version
 * bump. See `@sainte-beuve/contracts/routes/webhooks`.
 */
export interface RequestScope {
  /** The incoming request, for a facade that keys its container off a host or a header. */
  req: Request
  /** The runtime's bindings: a Worker's `env`. Undefined on a runtime that has none. */
  env: unknown
}

export interface AppOptions {
  resolveContainer: (scope: RequestScope) => AppContainer | Promise<AppContainer>
  /**
   * Origins the SPA is served from, or a callback for a runtime that only learns
   * them per request. `['*']` opens the API to any origin, which is the default
   * every facade ships and what local mode runs on.
   */
  corsOrigins?: string[] | ((scope: RequestScope) => string[])
}

function scopeOf(c: Context<AppEnv>): RequestScope {
  return { req: c.req.raw, env: c.env }
}

/**
 * Let a browser send its session, but only to an origin this deployment named.
 *
 * The session cookie is a CREDENTIAL, and a browser sends one cross-origin only
 * where the response says it may. The header is invalid beside a wildcard
 * origin and browsers refuse the pair outright, so it is added AFTERWARDS and
 * only where `allowedOrigin` echoed a real origin. A hosted deployment that
 * leaves CORS_ORIGINS at `*` therefore has an SPA that can read the board and
 * can never sign in, which is the loud failure rather than the quiet one.
 */
const allowCredentials: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  const echoed = c.res.headers.get('access-control-allow-origin')
  if (echoed !== null && echoed !== WILDCARD) {
    c.res.headers.set('access-control-allow-credentials', 'true')
  }
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { corsOrigins } = options
  const originsFor =
    typeof corsOrigins === 'function' ? corsOrigins : () => corsOrigins ?? [WILDCARD]

  app.use('*', allowCredentials)

  app.use(
    '*',
    cors({
      origin: (origin, c) =>
        allowedOrigin(originsFor(scopeOf(c)), {
          origin,
          path: c.req.path,
          method: intendedMethod(c),
        }),
    }),
  )

  app.use('*', async (c, next) => {
    c.set('container', await options.resolveContainer(scopeOf(c)))
    await next()
  })

  // Before the caller is resolved, because refusing this costs nothing and
  // resolving a session for a request that is about to be refused costs a store
  // read: a cross-site write carries the session cookie whether or not CORS
  // will show the answer, so it has to be refused rather than merely hidden.
  app.use(
    '/api/v1/*',
    writeOriginGuard((c) => originsFor(scopeOf(c))),
  )

  // After the container and before every route under it: the caller is resolved
  // once per request, and a deployment that insists on knowing who is calling
  // refuses here rather than in each controller. The webhook and connect paths
  // sit outside `/api/v1` and are authenticated by their own signatures.
  app.use('/api/v1/*', authentication())

  app.route('/', healthController())
  app.route('/', webhookController())
  app.route('/', connectController())
  app.route('/api/v1', workspaceController())
  app.route('/api/v1', projectController())
  app.route('/api/v1', attentionController())
  app.route('/api/v1', authController())
  app.route('/api/v1', reviewerController())
  app.route('/api/v1', reviewController())
  app.route('/api/v1', aiReviewController())
  app.route('/api/v1', settingsController())
  app.route('/api/v1', connectionsController())

  app.notFound((c) => c.json(errorBody('not_found', `No route for ${c.req.path}`), 404))
  app.onError(handleError)

  return app
}
