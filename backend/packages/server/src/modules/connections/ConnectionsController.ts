import {
  disconnectVcsSignInContract,
  getConnectionsContract,
  startGitHubAppInstallContract,
  startVcsSignInContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { ConnectionsService } from './ConnectionsService.js'

/**
 * The connection API behind the Configuration screen's host and Slack cards.
 *
 * Under `/api/v1/settings` with the credential routes, and therefore behind the
 * same two guards: nothing here reads a credential back out, and the
 * `/api/v1/settings` prefix is excluded from the wildcard CORS default (see
 * `allowedOrigin` in app.ts), because a route that starts a connect flow can
 * store a credential when it comes back. Neither is authentication; that is the
 * gap the auth slice closes (docs/implementation-plan.md).
 */
export function connectionsController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getConnectionsContract, async (c) => {
    return c.json(await new ConnectionsService(c.get('container')).read(), 200)
  })

  buildHonoRoute(app, startGitHubAppInstallContract, async (c) => {
    const url = await new ConnectionsService(c.get('container')).appInstallUrl()
    return c.json({ url }, 200)
  })

  buildHonoRoute(app, startVcsSignInContract, async (c) => {
    // The API's own origin, from the request rather than from configuration: the
    // redirect URI the host matches has to name the origin that will receive
    // the callback, and that is the one this request arrived on.
    const url = await new ConnectionsService(c.get('container')).signInUrl(
      c.req.valid('param').provider,
      new URL(c.req.url).origin,
    )
    return c.json({ url }, 200)
  })

  buildHonoRoute(app, disconnectVcsSignInContract, async (c) => {
    const service = new ConnectionsService(c.get('container'))
    await service.signOut(c.req.valid('param').provider)
    // The whole connection, not an acknowledgement: dropping this credential can
    // change which one is in force, and the screen has to show what took over.
    return c.json(await service.read(), 200)
  })

  return app
}
