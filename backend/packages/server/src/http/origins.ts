import { ForbiddenError } from '@sainte-beuve/kernel'
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from './env.js'
import { requestOrigin } from './forwarded.js'

/**
 * Which origins this deployment answers, and which ones may change something.
 *
 * One module rather than a block inside `createApp`, because the two questions
 * share a rule and must not come to hold two copies of it: what CORS echoes
 * decides whether a browser may READ a response, and the guard below decides
 * whether a browser's write runs at all. A cross-site form post is not
 * preflighted, so CORS hiding its response is not the same as refusing it.
 */

export const WILDCARD = '*'

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

const CROSS_SITE_WRITE =
  'This deployment does not accept a write from a page on another origin. A browser sends the ' +
  'session cookie with a cross-site form post whether or not CORS would show it the answer, so ' +
  'the origin has to be one this deployment named in CORS_ORIGINS (or its APP_BASE_URL).'

/**
 * The origins a deployment answers, with the SPA it already told us about.
 *
 * `APP_BASE_URL` is not a second way to spell `CORS_ORIGINS`: it is the same
 * fact, and a deployment that states where its SPA lives has named an origin
 * whether or not it also listed it. Folding it in here is what keeps the
 * wildcard DEFAULT from being a trap — the client sends `credentials:
 * 'include'` on every call, a browser rejects any response to one that carries
 * `Access-Control-Allow-Origin: *`, and a hosted deployment left on the default
 * would therefore lose every request rather than only its sign-in.
 *
 * Exported and called by each runtime facade rather than folded into
 * `createApp`, because the facades are where configuration is read and they
 * have to read it the same way.
 */
export function withAppOrigin(
  configured: readonly string[],
  appBaseUrl: string | null | undefined,
): string[] {
  const origins = [...configured]
  if (!appBaseUrl) return origins
  let origin: string
  try {
    origin = new URL(appBaseUrl).origin
  } catch {
    // A base URL nobody can parse is a variable to fix, not a reason to refuse
    // to boot: `/health` reports the mode, and the SPA reports its own failure.
    return origins
  }
  return origins.includes(origin) ? origins : [...origins, origin]
}

/**
 * What to echo back as `Access-Control-Allow-Origin`. The wildcard is answered with
 * the literal `*`: Hono matches a configured LIST against the request's origin, so a
 * list holding `'*'` matches no real origin and the response carries no CORS header
 * at all, which is the browser-side symptom of "the API is up and the SPA cannot
 * reach it".
 *
 * The wildcard opens READS, and only for a client that did not ask to send a
 * credential — a browser refuses `*` outright on a credentialed request, which
 * is why `withAppOrigin` exists and why a hosted deployment names its SPA. It
 * stops at every request that changes something, at the configuration routes
 * whether they are read or written, and at the AI-review routes whose GETs spend
 * the deployment's cat-factory key: `*` on a write would let any page an
 * operator happens to visit preflight a `DELETE /api/v1/projects/<id>` and empty
 * the registry, and `*` on an AI-review read would let it lift the findings of a
 * private pull request and loop the request to burn the key. Those answer an
 * origin the deployment NAMED, plus loopback, which is the local SPA and is
 * already code running on the operator's own machine.
 *
 * An inbound webhook is unaffected: GitHub and Slack send no `Origin`, and a
 * missing `Access-Control-Allow-Origin` is a rule for browsers rather than a
 * refusal.
 */
export function allowedOrigin(
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
export function intendedMethod(c: Context<AppEnv>): string {
  if (c.req.method !== 'OPTIONS') return c.req.method
  return (c.req.header('access-control-request-method') ?? c.req.method).toUpperCase()
}

/**
 * Refuse a state-changing request a browser made from an origin this deployment
 * did not name.
 *
 * CORS is not this check. A cross-site POST with a `text/plain` body is a SIMPLE
 * request: there is no preflight to refuse, the browser sends the session cookie
 * because the cookie is `SameSite=None` on a split-host deployment, and the only
 * thing CORS withholds is the answer — by which time the write has happened. The
 * `Origin` header is what closes it: a browser sets it on every unsafe method,
 * and a caller that sets none is not a browser (a CI job on an API key, or an
 * inbound webhook, which is authenticated by its own signature anyway).
 *
 * Same-origin passes on the origin the browser addressed rather than the URL
 * this process was handed, so a deployment behind a TLS terminator does not
 * refuse its own SPA over a scheme it never sees.
 */
export function writeOriginGuard(
  originsFor: (c: Context<AppEnv>) => readonly string[],
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = c.req.header('origin')
    if (origin === undefined || SAFE_METHODS.has(c.req.method)) return next()
    if (origin === requestOrigin(c)) return next()
    const echoed = allowedOrigin(originsFor(c), {
      origin,
      path: c.req.path,
      method: c.req.method,
    })
    if (echoed !== origin) throw new ForbiddenError(CROSS_SITE_WRITE)
    await next()
  }
}
