import {
  addProjectContract,
  listProjectsContract,
  removeProjectContract,
  updateProjectContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { ProjectService } from './ProjectService.js'

/** The project registry: which repositories this workspace watches. */
export function projectController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listProjectsContract, async (c) => {
    const service = new ProjectService(c.get('container'))
    return c.json({ projects: await service.list() }, 200)
  })

  buildHonoRoute(app, addProjectContract, async (c) => {
    const service = new ProjectService(c.get('container'))
    return c.json(await service.add(c.req.valid('json')), 201)
  })

  buildHonoRoute(app, updateProjectContract, async (c) => {
    const service = new ProjectService(c.get('container'))
    const { projectId } = c.req.valid('param')
    return c.json(await service.update(projectId, c.req.valid('json')), 200)
  })

  buildHonoRoute(app, removeProjectContract, async (c) => {
    const service = new ProjectService(c.get('container'))
    const { projectId } = c.req.valid('param')
    // What is left, not an acknowledgement: the screen redraws the list.
    return c.json({ projects: await service.remove(projectId) }, 200)
  })

  return app
}
