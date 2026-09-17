import {
  addProjectContract,
  listProjectsContract,
  removeProjectContract,
  updateProjectContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { requireAdmin } from '../auth/principal.js'
import { ProjectService } from './ProjectService.js'

/**
 * The project registry: which repositories this workspace watches.
 *
 * The LIST is everybody's, because the workspace is assembled from it and a
 * member who could not read the registry would have no three lists. The WRITES
 * are an admin's: registering a repository is this org claiming responsibility
 * for it, which is also what places an inbound webhook in a tenancy.
 */
export function projectController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listProjectsContract, async (c) => {
    const service = new ProjectService(c.get('container'))
    return c.json({ projects: await service.list() }, 200)
  })

  buildHonoRoute(app, addProjectContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new ProjectService(c.get('container'))
    return c.json(await service.add(c.req.valid('json')), 201)
  })

  buildHonoRoute(app, updateProjectContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new ProjectService(c.get('container'))
    const { projectId } = c.req.valid('param')
    return c.json(await service.update(projectId, c.req.valid('json')), 200)
  })

  buildHonoRoute(app, removeProjectContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new ProjectService(c.get('container'))
    const { projectId } = c.req.valid('param')
    // What is left, not an acknowledgement: the screen redraws the list.
    return c.json({ projects: await service.remove(projectId) }, 200)
  })

  return app
}

const NOT_AN_ADMIN =
  'Only an admin of this org can change which repositories it watches. Ask an admin to register ' +
  'or remove one.'
