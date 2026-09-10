import { getViewerContract, getWorkspaceContract } from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { ViewerService } from '../identity/ViewerService.js'
import { WorkspaceService } from './WorkspaceService.js'

/**
 * The main working space: who you are, and the three lists you have to act on.
 *
 * Two routes rather than one, because they have different costs and different
 * failure modes. `/me` is a local read plus one call to whichever host this
 * deployment is connected to, and it is what a screen needs before it can show
 * anything; `/workspace` sweeps every registered project and is the one that
 * takes a second on a large registry.
 */
export function workspaceController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getViewerContract, async (c) => {
    return c.json(await new ViewerService(c.get('container')).current(), 200)
  })

  buildHonoRoute(app, getWorkspaceContract, async (c) => {
    return c.json(await new WorkspaceService(c.get('container')).read(), 200)
  })

  return app
}
