import { getCapabilitiesContract } from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { resolveCapabilities } from '../../integrations/capabilities.js'

/**
 * What this org can do that depends on an integration. Not admin-only, unlike
 * the Configuration routes: a member about to press "AI review" is who needs to
 * be told it cannot work yet, and the answer carries no configuration.
 */
export function capabilitiesController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getCapabilitiesContract, async (c) => {
    return c.json(await resolveCapabilities(c.get('container')), 200)
  })

  return app
}
