import {
  clearIntegrationTokenContract,
  getIntegrationSettingsContract,
  setIntegrationTokenContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { requireAdmin } from '../auth/principal.js'
import { IntegrationSettingsService } from './IntegrationSettingsService.js'

/**
 * The configuration API behind the SPA's Configuration screen.
 *
 * Under `/api/v1` with every other route rather than on a separate admin
 * surface: which routes are an administrator's is a question about the CALLER,
 * and answering it with a base path would mean answering it twice.
 *
 * These are the only routes that hold a credential, and three things guard them.
 * They are ADMIN-ONLY, because a stored token is what the whole org's board acts
 * through; a token can be written and never read back; and the
 * `/api/v1/settings` prefix is excluded from the wildcard CORS default (see
 * `allowedOrigin` in app.ts), because a write route reachable from any origin
 * lets any page the operator visits overwrite this org's tokens.
 */
export function settingsController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getIntegrationSettingsContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new IntegrationSettingsService(c.get('container'))
    return c.json({ integrations: await service.list() }, 200)
  })

  buildHonoRoute(app, setIntegrationTokenContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new IntegrationSettingsService(c.get('container'))
    const { integrationId } = c.req.valid('param')
    return c.json(await service.setToken(integrationId, c.req.valid('json').token), 200)
  })

  buildHonoRoute(app, clearIntegrationTokenContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new IntegrationSettingsService(c.get('container'))
    const { integrationId } = c.req.valid('param')
    return c.json(await service.clearToken(integrationId), 200)
  })

  return app
}

const NOT_AN_ADMIN =
  'Only an admin of this org can see or change the credentials it works through. Ask an admin, ' +
  "or call with this deployment's own key as `Authorization: Bearer <AUTH_API_KEY>`."
