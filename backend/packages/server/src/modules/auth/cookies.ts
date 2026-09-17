import type { CookieOptions } from 'hono/utils/cookie'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Input } from 'hono'
import type { AppContainer } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { forwardedProto } from '../../http/forwarded.js'
import type { AnyAppContext } from './principal.js'

/** The three parameters every helper below is generic over. See `AnyAppContext`. */
type Ctx<E extends AppEnv, P extends string, I extends Input> = AnyAppContext<E, P, I>

/**
 * How a browser carries its session.
 *
 * A cookie rather than a header, because the value has to survive a NAVIGATION:
 * the sign-in ends as a redirect from a source-control host, and there is no
 * JavaScript in that round trip to catch a token out of a response body. It is
 * `HttpOnly` for the reason that follows from the same fact: nothing in the page
 * needs to read it, so nothing in the page should be able to.
 */

export const SESSION_COOKIE = 'sb_session'

/**
 * How a browser proves that the round trip coming back is the one IT started.
 *
 * Its own cookie rather than a claim on the session, because the flow starts
 * before there is a session to claim anything on: the whole point of a sign-in
 * is that the caller is not yet anybody. It lives as long as the state it is
 * paired with. See `RoundTripState`.
 */
export const FLOW_COOKIE = 'sb_flow'

/**
 * Whether the SPA is on a different site from the API, decided by hostname.
 *
 * `SameSite=Lax` is not sent on a cross-site fetch, so a deployment serving its
 * SPA from another host would have a sign-in that completes and a session that
 * is never presented again. The comparison is on the HOSTNAME rather than on the
 * registrable domain, which over-applies `None` to a deployment split across two
 * subdomains of one domain (`app.example.com` and `api.example.com`, where `Lax`
 * would have worked). That is the direction to be wrong in: `None` still works
 * there, where a missed cross-site case is a sign-in that silently does nothing.
 *
 * Deriving it rather than configuring it keeps one fact in one place: the
 * deployment already says where its SPA is, and a second variable saying the
 * same thing differently is a second variable to get wrong.
 */
function isCrossSite(container: AppContainer, requestUrl: string): boolean {
  if (container.appBaseUrl === null) return false
  try {
    return new URL(container.appBaseUrl).hostname !== new URL(requestUrl).hostname
  } catch {
    return false
  }
}

/**
 * Whether the BROWSER reached this deployment over TLS, which is not the same
 * question as which scheme this process was handed.
 *
 * A single-host Node deployment behind nginx or any other TLS terminator
 * receives `http://` on every request, so the scheme alone drops `Secure` from
 * the one cookie that must never travel in the clear. `forwardedProto` is what
 * closes that, and it is shared with the write-origin guard because reading the
 * same header two ways is how the two come to disagree.
 */
function reachedOverTls<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
  container: AppContainer,
  crossSite: boolean,
): boolean {
  // `SameSite=None` is refused outright by browsers without `Secure`.
  if (crossSite) return true
  const forwarded = forwardedProto(c)
  if (forwarded !== null) return forwarded === 'https'
  // Same hostname as the SPA and the deployment said the SPA is on https, so
  // this request reached that same host over TLS however it arrived here. One
  // fact in one place: nothing new to configure, and no second variable to get
  // out of step with `APP_BASE_URL`.
  if (container.appBaseUrl?.toLowerCase().startsWith('https://') === true) return true
  // Whatever is left is the scheme this request arrived on, which is what
  // leaves a local `http://localhost` run working.
  return new URL(c.req.url).protocol === 'https:'
}

function optionsFor<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
  container: AppContainer,
): CookieOptions {
  const crossSite = isCrossSite(container, c.req.url)
  return {
    httpOnly: true,
    path: '/',
    sameSite: crossSite ? 'None' : 'Lax',
    secure: reachedOverTls(c, container, crossSite),
  }
}

/**
 * Remember which browser started a round trip, for as long as its state lives.
 *
 * The SAME attributes the session cookie gets, which is the point of deriving
 * them once: the callback is a top-level navigation from a source-control host,
 * so `Lax` carries it on a single-host deployment, and a split-host one needs
 * exactly the `None; Secure` its session already needs. A deployment where this
 * cookie cannot be stored is one where the session cookie could not be either,
 * so this refuses nothing that would otherwise have worked.
 */
export function writeFlowCookie<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
  container: AppContainer,
  nonce: string,
  lifetimeMs: number,
): void {
  setCookie(c, FLOW_COOKIE, nonce, {
    ...optionsFor(c, container),
    maxAge: Math.floor(lifetimeMs / 1000),
  })
}

/** What the browser carried back, or null. */
export function readFlowCookie<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
): string | null {
  return getCookie(c, FLOW_COOKIE) ?? null
}

/**
 * Drop it once the round trip is over, whether or not it worked.
 *
 * A nonce is good for one callback. Leaving it behind means a browser holding a
 * spent one, and the next flow overwrites it anyway; clearing is what keeps a
 * failed attempt from being retried with a state somebody else can still reach.
 */
export function clearFlowCookie<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
  container: AppContainer,
): void {
  deleteCookie(c, FLOW_COOKIE, optionsFor(c, container))
}

/** The value a request presents, or null. */
export function readSessionCookie<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null
}

/**
 * Hand the browser a session. `maxAge` matches the row's absolute expiry, so a
 * cookie does not outlive the session it names and a closed tab does not come
 * back holding a value the store has already swept.
 */
export function writeSessionCookie<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
  container: AppContainer,
  session: { token: string; expiresAt: number },
): void {
  const lifetimeMs = Math.max(0, session.expiresAt - container.clock.now())
  setCookie(c, SESSION_COOKIE, session.token, {
    ...optionsFor(c, container),
    maxAge: Math.floor(lifetimeMs / 1000),
  })
}

/**
 * Drop it. The attributes have to MATCH the ones it was set with, or the browser
 * keeps the original beside the expired one and the next request presents a
 * session the API has already revoked.
 */
export function clearSessionCookie<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
  container: AppContainer,
): void {
  deleteCookie(c, SESSION_COOKIE, optionsFor(c, container))
}
