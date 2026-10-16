import { listPullRequestsToReviewContract } from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { principalOf } from '../auth/principal.js'
import { ToReviewService } from './ToReviewService.js'

/** PRs to review: the open pull requests the viewer is best placed to review next. */
export function toReviewController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listPullRequestsToReviewContract, async (c) => {
    const service = new ToReviewService(c.get('container'), principalOf(c))
    return c.json(await service.list(c.req.valid('query')), 200)
  })

  return app
}
