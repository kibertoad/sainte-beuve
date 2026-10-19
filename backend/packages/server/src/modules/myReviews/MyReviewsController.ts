import { declineReviewRequestContract, listMyReviewsContract } from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { principalOf } from '../auth/principal.js'
import { MyReviewsService } from './MyReviewsService.js'
import { declineReviewRequest } from './declineReviewRequest.js'

/** My Reviews: other people's pull requests the viewer has a part in. */
export function myReviewsController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listMyReviewsContract, async (c) => {
    const service = new MyReviewsService(c.get('container'), principalOf(c))
    return c.json(await service.list(c.req.valid('query')), 200)
  })

  buildHonoRoute(app, declineReviewRequestContract, async (c) => {
    const declined = await declineReviewRequest(
      c.get('container'),
      principalOf(c),
      c.req.valid('json'),
    )
    return c.json(declined, 200)
  })

  return app
}
