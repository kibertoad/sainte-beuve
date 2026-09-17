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
import { STATE_LIFETIME_MS } from '../../crypto/HmacStateSigner.js'
import type { AppEnv } from '../../http/env.js'
import { ConnectionsService } from '../connections/ConnectionsService.js'
import { ApiKeyService } from './ApiKeyService.js'
import { AuthService } from './AuthService.js'
import { clearSessionCookie, writeFlowCookie } from './cookies.js'
import { principalOf, refuseIfAnonymous, requireAdmin, type RequestPrincipal } from './principal.js'
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
    const container = c.get('container')
    // The API's own origin, from the request rather than from configuration: the
    // redirect URI the host matches has to name the origin that will receive the
    // callback, and that is the one this request arrived on.
    const { url, nonce } = await new ConnectionsService(container).signInUrl(
      c.req.valid('param').provider,
      new URL(c.req.url).origin,
      'session',
      // The one place an org is chosen by something a caller sent, and the
      // choice goes into the SIGNED state rather than riding the query string
      // back: a slug in the callback URL would let anybody who can hand somebody
      // a link decide which tenancy they land in.
      c.req.valid('query').org,
    )
    // On the SAME answer that carries the URL, so the browser that is about to
    // leave is the only one that can come back. See `RoundTripState`.
    writeFlowCookie(c, container, nonce, STATE_LIFETIME_MS)
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

  apiKeyRoutes(app)

  return app
}

/**
 * The keys a machine calls with, mounted apart from the session routes because
 * they answer a different caller: `/auth` is what a BROWSER reaches before it can
 * prove anything, and these sit under `/settings` with the other credential
 * routes, behind the CORS rule that keeps a page an operator happens to visit
 * from preflighting a write into them (see `allowedOrigin`).
 */
function apiKeyRoutes(app: Hono<AppEnv>): void {
  buildHonoRoute(app, listApiKeysContract, async (c) => {
    // Admin-only, unlike before the org boundary existed. A key's LABEL and the
    // last four characters of its value are how an operator decides which row in
    // front of them is the credential in their CI secret store, and that is an
    // administrator's question about the deployment rather than something a
    // member of the directory has any use for.
    await requireAdmin(c, NOT_AN_ADMIN)
    return c.json({ apiKeys: await new ApiKeyService(c.get('container')).list() }, 200)
  })

  buildHonoRoute(app, createApiKeyContract, async (c) => {
    // The only route in the tree that an `open` deployment still refuses an
    // anonymous caller, because it is the only one whose result survives the
    // mode: everything else an unnamed caller can do here is undone by setting
    // AUTH_MODE=required, and a key minted a minute earlier is not.
    //
    // The admin check BELOW is a different question and both are asked: an
    // anonymous caller on an `open` deployment is an admin (see `roleOf`), so
    // the role guard alone would let one mint a key that outlives the mode.
    refuseIfAnonymous(principalOf(c), CANNOT_MINT)
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new ApiKeyService(c.get('container'))
    const issued = await service.mint({
      label: c.req.valid('json').label,
      // What the key may do, which is a decision at MINT time and never
      // afterwards: a key outlives whoever made it, so inheriting the minter's
      // role would leave a CI job able to revoke the credentials it runs on the
      // day an operator mints one.
      role: c.req.valid('json').role,
      // Whose key it is, when a person minted it. A key minted by another key
      // records nobody rather than the key it was minted through, because the
      // field names a REVIEWER and a key is not one.
      createdBy: mintedBy(principalOf(c)),
    })
    return c.json(issued, 201)
  })

  buildHonoRoute(app, revokeApiKeyContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new ApiKeyService(c.get('container'))
    await service.revoke(c.req.valid('param').keyId)
    return c.json({ apiKeys: await service.list() }, 200)
  })
}

const NOT_AN_ADMIN =
  'Only an admin of this org can see or change the keys machines call it with. Ask an admin, or ' +
  "call with this deployment's own key as `Authorization: Bearer <AUTH_API_KEY>`."

const CANNOT_MINT =
  'An API key outlives the mode it was minted in, so this deployment will not hand one to a ' +
  'caller it cannot name, even where it refuses nobody else: sign in from the SPA, or present ' +
  "this deployment's own key as `Authorization: Bearer <AUTH_API_KEY>`."

function mintedBy(principal: RequestPrincipal): string | null {
  return principal.kind === 'session' ? principal.session.reviewerId : null
}

/** Nothing to revoke for a caller who is not on a session, which is not a fault. */
async function revokeSession(container: AppContainer, principal: RequestPrincipal): Promise<void> {
  if (principal.kind !== 'session') return
  await new SessionService(container).revoke(principal.session.id)
}
