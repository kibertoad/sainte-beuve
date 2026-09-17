import {
  disconnectVcsSignInContract,
  getConnectionsContract,
  startGitHubAppInstallContract,
  startVcsSignInContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import { STATE_LIFETIME_MS } from '../../crypto/HmacStateSigner.js'
import type { AppEnv } from '../../http/env.js'
import { writeFlowCookie } from '../auth/cookies.js'
import { requireAdmin } from '../auth/principal.js'
import { ConnectionsService } from './ConnectionsService.js'

/**
 * The connection API behind the Configuration screen's host and Slack cards.
 *
 * Under `/api/v1/settings` with the credential routes, and therefore behind the
 * same three guards: they are ADMIN-ONLY, nothing here reads a credential back
 * out, and the `/api/v1/settings` prefix is excluded from the wildcard CORS
 * default (see `allowedOrigin` in app.ts), because a route that starts a connect
 * flow can store a credential when it comes back.
 *
 * `startVcsSignIn` is the CONNECT flow, which stores the org's shared
 * credential, and is an admin's. The sign-in that only proves who somebody is
 * lives at `/api/v1/auth/sign-in/<host>`, outside the guard entirely, because
 * being refused for not being signed in is what it exists to fix.
 */
export function connectionsController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getConnectionsContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    return c.json(await new ConnectionsService(c.get('container')).read(), 200)
  })

  buildHonoRoute(app, startGitHubAppInstallContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const container = c.get('container')
    const { url, nonce } = await new ConnectionsService(container).appInstallUrl()
    // On the same answer that carries the URL: the setup callback accepts only
    // the browser that asked for it. See `RoundTripState`.
    writeFlowCookie(c, container, nonce, STATE_LIFETIME_MS)
    return c.json({ url }, 200)
  })

  buildHonoRoute(app, startVcsSignInContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const container = c.get('container')
    // The API's own origin, from the request rather than from configuration: the
    // redirect URI the host matches has to name the origin that will receive
    // the callback, and that is the one this request arrived on.
    const { url, nonce } = await new ConnectionsService(container).signInUrl(
      c.req.valid('param').provider,
      new URL(c.req.url).origin,
    )
    writeFlowCookie(c, container, nonce, STATE_LIFETIME_MS)
    return c.json({ url }, 200)
  })

  buildHonoRoute(app, disconnectVcsSignInContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new ConnectionsService(c.get('container'))
    await service.signOut(c.req.valid('param').provider)
    // The whole connection, not an acknowledgement: dropping this credential can
    // change which one is in force, and the screen has to show what took over.
    return c.json(await service.read(), 200)
  })

  return app
}

const NOT_AN_ADMIN =
  'Only an admin of this org can see or change how it reaches GitHub, GitLab and Slack. Ask an ' +
  'admin, or sign in at /api/v1/auth/sign-in/<host> if you are only trying to say who you are.'
