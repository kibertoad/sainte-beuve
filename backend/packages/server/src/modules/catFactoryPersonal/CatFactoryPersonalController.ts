import {
  clearCatFactoryPersonalKeyContract,
  getCatFactoryPersonalContract,
  setCatFactoryPersonalKeyContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { principalOf } from '../auth/principal.js'
import { CatFactoryPersonalService } from './CatFactoryPersonalService.js'

/** The caller's own cat-factory key. Any member's, for themselves; nobody else's. */
export function catFactoryPersonalController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getCatFactoryPersonalContract, async (c) => {
    const service = new CatFactoryPersonalService(c.get('container'), principalOf(c))
    return c.json(await service.read(), 200)
  })

  buildHonoRoute(app, setCatFactoryPersonalKeyContract, async (c) => {
    const service = new CatFactoryPersonalService(c.get('container'), principalOf(c))
    return c.json(await service.setKey(c.req.valid('json').token), 200)
  })

  buildHonoRoute(app, clearCatFactoryPersonalKeyContract, async (c) => {
    const service = new CatFactoryPersonalService(c.get('container'), principalOf(c))
    return c.json(await service.clearKey(), 200)
  })

  return app
}
