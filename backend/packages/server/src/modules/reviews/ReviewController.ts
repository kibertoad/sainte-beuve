import {
  ACTIVE_REVIEW_STATUSES,
  assignReviewersContract,
  createReviewContract,
  getReviewContract,
  listReviewsContract,
  REVIEW_PAGE_LIMIT,
  updateReviewStatusContract,
} from '@sainte-beuve/contracts'
import { assertFound } from '@sainte-beuve/kernel'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { ReviewService } from './ReviewService.js'

/**
 * The review board API: track a pull request, route it, move it through its
 * statuses. Delegating one to cat-factory and curating what came back are in
 * AiReviewController, which is addressed by run rather than by review.
 */
export function reviewController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  mountBoardRead(app)

  buildHonoRoute(app, createReviewContract, async (c) => {
    const service = new ReviewService(c.get('container'))
    return c.json(await service.create(c.req.valid('json')), 201)
  })

  buildHonoRoute(app, getReviewContract, async (c) => {
    const { reviewId } = c.req.valid('param')
    const review = assertFound(
      await c.get('container').repositories.reviews.getById(reviewId),
      `No review request ${reviewId}`,
    )
    return c.json(review, 200)
  })

  buildHonoRoute(app, updateReviewStatusContract, async (c) => {
    const service = new ReviewService(c.get('container'))
    const { reviewId } = c.req.valid('param')
    return c.json(await service.updateStatus(reviewId, c.req.valid('json').status), 200)
  })

  buildHonoRoute(app, assignReviewersContract, async (c) => {
    const service = new ReviewService(c.get('container'))
    const { reviewId } = c.req.valid('param')
    const { count, excludeReviewerIds } = c.req.valid('json')
    return c.json(await service.assign(reviewId, { count, excludeReviewerIds }), 200)
  })

  return app
}

/**
 * The board read, and two defaults that are the difference between a screen and
 * a table dump.
 *
 * A caller that names no status gets the ACTIVE reviews: terminal ones are never
 * archived, so the unfiltered read grew with everything the deployment had ever
 * tracked and re-decoded a payload per row for rows nobody looks at. History is
 * still readable — `?status=closed` asks for it — but somebody has to ask.
 *
 * The cap applies either way, asked for or not, because the point is that the
 * answer stops growing with the table.
 *
 * What comes back is the BOARD rather than the stored rows: the people on each
 * review named, most urgent first. Both of those are `buildBoard` in
 * `@sainte-beuve/reviewers`, so the order is a decision with a suite rather than
 * whatever order the store happened to answer in.
 */
function mountBoardRead(app: Hono<AppEnv>): void {
  buildHonoRoute(app, listReviewsContract, async (c) => {
    const { status, limit } = c.req.valid('query')
    const service = new ReviewService(c.get('container'))
    const reviews = await service.board({
      status: status ?? [...ACTIVE_REVIEW_STATUSES],
      limit: limit ?? REVIEW_PAGE_LIMIT,
    })
    return c.json({ reviews }, 200)
  })
}
