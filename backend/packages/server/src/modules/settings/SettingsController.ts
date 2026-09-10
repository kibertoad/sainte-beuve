import {
  clearIntegrationTokenContract,
  getIntegrationSettingsContract,
  setIntegrationTokenContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { IntegrationSettingsService } from './IntegrationSettingsService.js'

/**
 * The configuration API behind the SPA's Configuration screen.
 *
 * Under `/api/v1` with every other route, not on a separate admin surface: it is
 * the same single-tenant deployment either way until the auth slice lands, and a
 * second base path would have to be undone then.
 *
 * These are the only routes that hold a credential, so two things guard them
 * until there is a session to check. A token can be written and never read back,
 * and the `/api/v1/settings` prefix is excluded from the wildcard CORS default
 * (see `allowedOrigin` in app.ts), because a write route reachable from any
 * origin lets any page the operator visits overwrite this deployment's tokens.
 * Neither is authentication: a caller that can reach the deployment directly can
 * still write, which is the gap the auth slice closes
 * (docs/implementation-plan.md).
 */
export function settingsController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getIntegrationSettingsContract, async (c) => {
    const service = new IntegrationSettingsService(c.get('container'))
    return c.json({ integrations: await service.list() }, 200)
  })

  buildHonoRoute(app, setIntegrationTokenContract, async (c) => {
    const service = new IntegrationSettingsService(c.get('container'))
    const { integrationId } = c.req.valid('param')
    return c.json(await service.setToken(integrationId, c.req.valid('json').token), 200)
  })

  buildHonoRoute(app, clearIntegrationTokenContract, async (c) => {
    const service = new IntegrationSettingsService(c.get('container'))
    const { integrationId } = c.req.valid('param')
    return c.json(await service.clearToken(integrationId), 200)
  })

  return app
}
