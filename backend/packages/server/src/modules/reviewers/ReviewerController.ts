import {
  createReviewerContract,
  listReviewersContract,
  updateReviewerContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { requireAdmin } from '../auth/principal.js'
import { ReviewerService } from './ReviewerService.js'

/**
 * The reviewer directory API.
 *
 * Every route is mounted from its `@sainte-beuve/contracts` contract via
 * `buildHonoRoute`: the method, the path and the request validation come from the
 * contract, and `c.req.valid(...)` plus the `c.json(body, status)` return are typed
 * from it. The frontend calls the same contract objects, so a route and its client
 * cannot drift.
 *
 * The LIST is everybody's: the board shows who a review went to, and an
 * attention request is addressed by skill, so a member who could not read the
 * directory could not read either. The two WRITES are an admin's — they decide
 * who is in the pool, who holds which skills, and, since this slice, who else
 * may administer the org.
 */
export function reviewerController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listReviewersContract, async (c) => {
    const service = new ReviewerService(c.get('container'))
    return c.json({ reviewers: await service.list() }, 200)
  })

  buildHonoRoute(app, createReviewerContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new ReviewerService(c.get('container'))
    return c.json(await service.create(c.req.valid('json')), 201)
  })

  buildHonoRoute(app, updateReviewerContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    const service = new ReviewerService(c.get('container'))
    const { reviewerId } = c.req.valid('param')
    return c.json(await service.update(reviewerId, c.req.valid('json')), 200)
  })

  return app
}

const NOT_AN_ADMIN =
  'Only an admin of this org can change its reviewer directory. Ask an admin to add somebody, ' +
  'edit their skills, or pause them.'
