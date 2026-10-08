import {
  listMyPullRequestsContract,
  mergeMyPullRequestContract,
  postMergeCommentContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { principalOf } from '../auth/principal.js'
import { MergeService } from './MergeService.js'
import { MyPullRequestsService } from './MyPullRequestsService.js'

/** My PRs: the viewer's own open pull requests, and merging them. */
export function myPullRequestsController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listMyPullRequestsContract, async (c) => {
    const service = new MyPullRequestsService(c.get('container'), principalOf(c))
    return c.json(await service.list(c.req.valid('query')), 200)
  })

  buildHonoRoute(app, mergeMyPullRequestContract, async (c) => {
    const service = new MergeService(c.get('container'), principalOf(c))
    return c.json(await service.merge(c.req.valid('json')), 200)
  })

  buildHonoRoute(app, postMergeCommentContract, async (c) => {
    const service = new MergeService(c.get('container'), principalOf(c))
    return c.json(await service.postComment(c.req.valid('json')), 200)
  })

  return app
}
