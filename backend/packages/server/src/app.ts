import type { Context } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppContainer } from './container.js'
import type { AppEnv } from './http/env.js'
import { errorBody, handleError } from './http/errors.js'
import { connectController } from './modules/connections/ConnectController.js'
import { connectionsController } from './modules/connections/ConnectionsController.js'
import { healthController } from './modules/health/HealthController.js'
import { reviewerController } from './modules/reviewers/ReviewerController.js'
import { reviewController } from './modules/reviews/ReviewController.js'
import { settingsController } from './modules/settings/SettingsController.js'
import { webhookController } from './modules/webhooks/WebhookController.js'

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

const WILDCARD = '*'

/** The routes that read and write a credential. See SettingsController. */
const CONFIGURATION_PATH = '/api/v1/settings'

/** The SPA in local development, on whatever port Nuxt settled for. */
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/

/**
 * What to echo back as `Access-Control-Allow-Origin`. The wildcard is answered with
 * the literal `*`: Hono matches a configured LIST against the request's origin, so a
 * list holding `'*'` matches no real origin and the response carries no CORS header
 * at all, which is the browser-side symptom of "the API is up and the SPA cannot
 * reach it".
 *
 * The wildcard stops at the configuration routes. Those write a credential and
 * carry no session to check, so answering `*` there would let any page an operator
 * happens to visit preflight a PUT and overwrite this deployment's tokens. They
 * answer an origin the deployment NAMED, plus loopback, which is the local SPA and
 * is already code running on the operator's own machine. A hosted deployment
 * therefore has to list its SPA origin in CORS_ORIGINS for the Configuration screen
 * to work, which is the trade this makes on purpose.
 */
function allowedOrigin(configured: readonly string[], origin: string, path: string): string | null {
  if (configured.includes(origin)) return origin
  if (!configured.includes(WILDCARD)) return null
  if (path.startsWith(CONFIGURATION_PATH)) {
    return LOOPBACK_ORIGIN.test(origin) ? origin : null
  }
  return WILDCARD
}

function scopeOf(c: Context<AppEnv>): RequestScope {
  return { req: c.req.raw, env: c.env }
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  const { corsOrigins } = options
  const originsFor =
    typeof corsOrigins === 'function' ? corsOrigins : () => corsOrigins ?? [WILDCARD]

  // No `Access-Control-Allow-Credentials`: the API carries no cookie session, and
  // the header is invalid beside a wildcard origin, which is the default.
  app.use(
    '*',
    cors({
      origin: (origin, c) => allowedOrigin(originsFor(scopeOf(c)), origin, c.req.path),
    }),
  )

  app.use('*', async (c, next) => {
    c.set('container', await options.resolveContainer(scopeOf(c)))
    await next()
  })

  app.route('/', healthController())
  app.route('/', webhookController())
  app.route('/', connectController())
  app.route('/api/v1', reviewerController())
  app.route('/api/v1', reviewController())
  app.route('/api/v1', settingsController())
  app.route('/api/v1', connectionsController())

  app.notFound((c) => c.json(errorBody('not_found', `No route for ${c.req.path}`), 404))
  app.onError(handleError)

  return app
}
