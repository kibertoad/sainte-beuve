import {
  createApiKeyContract,
  getAuthStateContract,
  listApiKeysContract,
  revokeApiKeyContract,
  signOutContract,
  startSessionSignInContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppContainer } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { ConnectionsService } from '../connections/ConnectionsService.js'
import { ApiKeyService } from './ApiKeyService.js'
import { AuthService } from './AuthService.js'
import { clearSessionCookie } from './cookies.js'
import { principalOf, type RequestPrincipal } from './principal.js'
import { SessionService } from './SessionService.js'

/**
 * Sessions, and the keys a machine calls with.
 *
 * Two prefixes on purpose. `/auth` is what a browser reaches before it can prove
 * anything, so it is the one place the guard steps aside; `/settings/api-keys`
 * mints a credential, so it sits with the other credential routes, behind the
 * same CORS rule that keeps a page an operator happens to visit from preflighting
 * a write into them (see `allowedOrigin` in app.ts).
 */
export function authController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getAuthStateContract, async (c) => {
    return c.json(await new AuthService(c.get('container')).state(principalOf(c)), 200)
  })

  buildHonoRoute(app, startSessionSignInContract, async (c) => {
    // The API's own origin, from the request rather than from configuration: the
    // redirect URI the host matches has to name the origin that will receive the
    // callback, and that is the one this request arrived on.
    const url = await new ConnectionsService(c.get('container')).signInUrl(
      c.req.valid('param').provider,
      new URL(c.req.url).origin,
      'session',
    )
    return c.json({ url }, 200)
  })

  buildHonoRoute(app, signOutContract, async (c) => {
    const container = c.get('container')
    const principal = principalOf(c)
    await revokeSession(container, principal)
    // Cleared unconditionally, including for a caller who was already signed
    // out: a cookie whose row is gone is the state a browser is left in by a
    // sweep or by a sign-out somewhere else, and leaving it there means every
    // request carries a value that resolves to nobody.
    clearSessionCookie(c, container)
    return c.json(await new AuthService(container).state({ kind: 'anonymous' }), 200)
  })

  buildHonoRoute(app, listApiKeysContract, async (c) => {
    return c.json({ apiKeys: await new ApiKeyService(c.get('container')).list() }, 200)
  })

  buildHonoRoute(app, createApiKeyContract, async (c) => {
    const service = new ApiKeyService(c.get('container'))
    const issued = await service.mint({
      label: c.req.valid('json').label,
      // Whose key it is, when a person minted it. A key minted by another key
      // records nobody rather than the key it was minted through, because the
      // field names a REVIEWER and a key is not one.
      createdBy: mintedBy(principalOf(c)),
    })
    return c.json(issued, 201)
  })

  buildHonoRoute(app, revokeApiKeyContract, async (c) => {
    const service = new ApiKeyService(c.get('container'))
    await service.revoke(c.req.valid('param').keyId)
    return c.json({ apiKeys: await service.list() }, 200)
  })

  return app
}

function mintedBy(principal: RequestPrincipal): string | null {
  return principal.kind === 'session' ? principal.session.reviewerId : null
}

/** Nothing to revoke for a caller who is not on a session, which is not a fault. */
async function revokeSession(container: AppContainer, principal: RequestPrincipal): Promise<void> {
  if (principal.kind !== 'session') return
  await new SessionService(container).revoke(principal.session.id)
}
