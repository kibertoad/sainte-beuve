import type { StoredSession } from '@sainte-beuve/kernel'
import { ForbiddenError, UnauthenticatedError } from '@sainte-beuve/kernel'
import type { Context, Input, MiddlewareHandler } from 'hono'
import type { AppContainer } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { ApiKeyService, type ApiKeyPrincipal } from './ApiKeyService.js'
import { readSessionCookie } from './cookies.js'
import { SessionService } from './SessionService.js'

/**
 * Who is calling, as the request handlers see it.
 *
 * Deliberately NOT the contract's `Principal`: that one carries the viewer,
 * because a screen needs to render a name, and assembling it costs two store
 * reads that most routes have no use for. This is the cheap half — a session row
 * or a key — and the controller that needs a person builds the other half from it.
 */
export type RequestPrincipal =
  | { kind: 'anonymous' }
  | { kind: 'session'; session: StoredSession }
  | ({ kind: 'api_key' } & ApiKeyPrincipal)

const ANONYMOUS: RequestPrincipal = { kind: 'anonymous' }

/**
 * A context on this app's env, whatever a route has WIDENED it with.
 *
 * `buildHonoRoute` hands a handler an env of ITS own intersected with ours, and
 * Hono's `Context` is invariant in that parameter, so a helper typed against the
 * bare `AppEnv` is not callable from inside a contract-mounted route. Every
 * helper below is generic over the three parameters instead, which infers to
 * whatever the call site has and constrains only the part that matters.
 */
export type AnyAppContext<
  E extends AppEnv = AppEnv,
  P extends string = string,
  I extends Input = Input,
> = Context<E, P, I>

/** The three parameters every helper below is generic over. Spelled once. */
type Ctx<E extends AppEnv, P extends string, I extends Input> = AnyAppContext<E, P, I>

/**
 * The paths that answer an anonymous caller even where the deployment insists on
 * knowing who is calling.
 *
 * All of `/auth`, and that is the whole list. A screen that had to be signed in
 * to discover that it is not signed in has nowhere to start, and a sign-in route
 * behind the guard it exists to satisfy is a deployment nobody can enter. The
 * API-key routes are deliberately NOT here: they mint a credential, and they
 * live under `/settings` with the others.
 */
const OPEN_PREFIX = '/api/v1/auth'

const NOT_AUTHENTICATED =
  'This deployment requires a caller to identify itself: sign in from the SPA, or present an API ' +
  'key as `Authorization: Bearer <key>`.'

const NOT_A_PERSON =
  'An API key is not a person, so it has no workspace: this route renders for whoever is signed ' +
  'in, and a key is nobody. Sign in from the SPA to read it.'

/** The bearer value on the request, from either place one can arrive. */
function bearerToken<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
): string | null {
  const header = c.req.header('authorization')
  if (header === undefined) return null
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const value = rest.join(' ').trim()
  return value.length === 0 ? null : value
}

/**
 * Resolve the caller.
 *
 * The COOKIE is tried first. A request carrying both is a browser that also set
 * a header, which is a script running inside somebody's page; the session is the
 * narrower authority of the two and is the one to act on.
 */
async function resolve<E extends AppEnv, P extends string, I extends Input>(
  container: AppContainer,
  c: Ctx<E, P, I>,
): Promise<RequestPrincipal> {
  const session = await new SessionService(container).resolve(readSessionCookie(c))
  if (session !== null) return { kind: 'session', session }
  const key = await new ApiKeyService(container).verify(bearerToken(c))
  return key === null ? ANONYMOUS : { kind: 'api_key', ...key }
}

/**
 * Put the caller on the context, and refuse an anonymous one where the
 * deployment said to.
 *
 * It runs on every `/api/v1` request rather than being applied per route,
 * because the failure mode of the other arrangement is a route somebody forgot
 * to guard: the list of routes grows every slice and the list of exemptions
 * above does not.
 */
export function authentication(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const container = c.get('container')
    const principal = await resolve(container, c)
    c.set('principal', principal)
    if (
      container.auth.mode === 'required' &&
      principal.kind === 'anonymous' &&
      !c.req.path.startsWith(OPEN_PREFIX)
    ) {
      throw new UnauthenticatedError(NOT_AUTHENTICATED)
    }
    await next()
  }
}

/**
 * The caller, for a handler that wants it.
 *
 * Anonymous when the middleware has not run, which is the honest default: the
 * webhook and connect routes sit outside `/api/v1` and are authenticated by
 * their own signatures, so a caller there is nobody as far as this is concerned.
 */
export function principalOf<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
): RequestPrincipal {
  // Annotated rather than inferred: `c.get` off a context generic in its env
  // widens to `any`, and an `any` here would turn every `principal.kind` check
  // at every call site into no check at all.
  const held: RequestPrincipal | undefined = c.get('principal')
  return held ?? ANONYMOUS
}

/**
 * Refuse a caller that cannot be a person, naming why.
 *
 * Anonymous is NOT refused here: on an `open` deployment it is the ordinary
 * state, and what to do about it is the viewer's decision (see `ViewerService`)
 * rather than this one's. A machine is refused, because there is no answer to
 * give it and inventing one would put somebody else's work on its screen.
 */
export function refuseIfMachine(principal: RequestPrincipal): void {
  if (principal.kind === 'api_key') throw new ForbiddenError(NOT_A_PERSON)
}

/**
 * The one way in for a caller this deployment cannot name, whichever mode it is in.
 *
 * `open` means the deployment refuses nobody, and the guard above therefore lets
 * an anonymous caller everywhere. That is the contract, and it holds for every
 * route whose effect is bounded by the mode: whoever can empty the project
 * registry today is whoever can reach the deployment today, and switching to
 * `required` takes that back. A minted API key is the one thing here that does
 * NOT come back — it is a durable bearer credential that keeps answering after
 * the switch — so the route that produces one asks who is calling even where
 * nothing else does. The caller names itself with a session or with
 * `AUTH_API_KEY`, which is the same bootstrap `required` already runs on.
 */
export function refuseIfAnonymous(principal: RequestPrincipal, reason: string): void {
  if (principal.kind === 'anonymous') throw new UnauthenticatedError(reason)
}
