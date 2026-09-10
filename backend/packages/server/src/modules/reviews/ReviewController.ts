import {
  assignReviewersContract,
  createReviewContract,
  getReviewContract,
  listReviewsContract,
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

  buildHonoRoute(app, listReviewsContract, async (c) => {
    const reviews = await c.get('container').repositories.reviews.list()
    return c.json({ reviews }, 200)
  })

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
