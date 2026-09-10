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
 * second base path would have to be undone then. What guards it in the meantime
 * is that a token can only be written, never read back.
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
