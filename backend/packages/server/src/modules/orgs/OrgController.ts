import { createOrgContract, listOrgsContract, updateOrgContract } from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { requireAdmin } from '../auth/principal.js'
import { OrgService } from './OrgService.js'

/**
 * The tenancies, for whoever administers this deployment.
 *
 * Three routes, and none of them takes an org: which org a request is IN is
 * decided by the credential it arrived on, before any handler runs. `list` shows
 * an operator what exists, `create` makes one, and `update` changes the one the
 * caller is already in — which is where `enrolment`, the decision about who may
 * join, is made and unmade. Everything else about the boundary happens below the
 * services, in the store each of them is bound to.
 */
const NOT_AN_ADMIN =
  'Only an admin of this org can see or create the tenancies on this deployment. Ask an admin, ' +
  "or call with this deployment's own key as `Authorization: Bearer <AUTH_API_KEY>`."

export function orgController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listOrgsContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    return c.json({ orgs: await new OrgService(c.get('container')).list() }, 200)
  })

  buildHonoRoute(app, createOrgContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    return c.json(await new OrgService(c.get('container')).create(c.req.valid('json')), 201)
  })

  buildHonoRoute(app, updateOrgContract, async (c) => {
    // Admin-only, like the two above, and for the sharpest reason of the three:
    // `enrolment` decides who may join this org at all.
    await requireAdmin(c, NOT_AN_ADMIN)
    return c.json(await new OrgService(c.get('container')).update(c.req.valid('json')), 200)
  })

  return app
}
