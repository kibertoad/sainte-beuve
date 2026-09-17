import type { CookieOptions } from 'hono/utils/cookie'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Input } from 'hono'
import type { AppContainer } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
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

function optionsFor<E extends AppEnv, P extends string, I extends Input>(
  c: Ctx<E, P, I>,
  container: AppContainer,
): CookieOptions {
  const crossSite = isCrossSite(container, c.req.url)
  return {
    httpOnly: true,
    path: '/',
    sameSite: crossSite ? 'None' : 'Lax',
    // `SameSite=None` is refused outright by browsers without `Secure`, so the
    // cross-site case forces it; otherwise it follows the scheme this request
    // arrived on, which leaves a local `http://localhost` run working.
    secure: crossSite || new URL(c.req.url).protocol === 'https:',
  }
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
