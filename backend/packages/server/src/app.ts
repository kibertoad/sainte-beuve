import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppContainer } from './container.js'
import type { AppEnv } from './http/env.js'
import { errorBody, handleError } from './http/errors.js'
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

const WILDCARD = '*'

/** The routes that read and write a credential. See SettingsController. */
const CONFIGURATION_PATH = '/api/v1/settings'

/**
 * The AI-review routes, whose reads are not reads. Answering one POLLS
 * cat-factory with this deployment's key and writes what it learns onto the run,
 * so the method says nothing about what the request costs. See AiReviewService.
 */
const AI_REVIEW_PATH = '/api/v1/ai-review'
/** The same routes addressed by review: `/api/v1/reviews/<id>/ai-review`. */
const AI_REVIEW_SUFFIX = '/ai-review'

/** The methods that change nothing. A path can still be guarded on its own. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The SPA in local development, on whatever port Nuxt settled for. */
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/

/**
 * What to echo back as `Access-Control-Allow-Origin`. The wildcard is answered with
 * the literal `*`: Hono matches a configured LIST against the request's origin, so a
 * list holding `'*'` matches no real origin and the response carries no CORS header
 * at all, which is the browser-side symptom of "the API is up and the SPA cannot
 * reach it".
 *
 * The wildcard opens READS. It stops at every request that changes something, at
 * the configuration routes whether they are read or written, and at the AI-review
 * routes whose GETs spend the deployment's cat-factory key, because no route here
 * carries a session to check: `*` on a write would let any page an operator
 * happens to visit preflight a `DELETE /api/v1/projects/<id>` and empty the
 * registry, or resolve somebody else's attention request, or overwrite this
 * deployment's tokens, and `*` on an AI-review read would let it lift the
 * findings of a private pull request and loop the request to burn the key. Those
 * answer an origin the deployment NAMED, plus loopback, which is the local SPA
 * and is already code running on the operator's own machine. A hosted deployment
 * therefore has to list its SPA origin in CORS_ORIGINS to do anything but read,
 * which is the trade this makes on purpose.
 *
 * An inbound webhook is unaffected: GitHub and Slack send no `Origin`, and a
 * missing `Access-Control-Allow-Origin` is a rule for browsers rather than a
 * refusal.
 */
function allowedOrigin(
  configured: readonly string[],
  request: { origin: string; path: string; method: string },
): string | null {
  if (configured.includes(request.origin)) return request.origin
  if (!configured.includes(WILDCARD)) return null
  // Loopback is echoed BY NAME even where the wildcard would do, and that is
  // what makes the session work in local development. The credentials header is
  // invalid beside `*`, so a local SPA answered with the wildcard would be told
  // it may read the board and never allowed to send its cookie: signed in on
  // the API and anonymous on every screen.
  if (LOOPBACK_ORIGIN.test(request.origin)) return request.origin
  return isGuarded(request) ? null : WILDCARD
}

/** Whether this is a request the wildcard does not cover. */
function isGuarded(request: { path: string; method: string }): boolean {
  if (request.path.startsWith(CONFIGURATION_PATH) || !SAFE_METHODS.has(request.method)) return true
  return request.path.startsWith(AI_REVIEW_PATH) || request.path.endsWith(AI_REVIEW_SUFFIX)
}

/**
 * What the browser is asking to do. On a preflight that is the header rather
 * than the method: the preflight itself is an OPTIONS, and reading the method
 * off it would report every write as safe.
 */
function intendedMethod(c: Context<AppEnv>): string {
  if (c.req.method !== 'OPTIONS') return c.req.method
  return (c.req.header('access-control-request-method') ?? c.req.method).toUpperCase()
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
