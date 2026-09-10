import {
  assignReviewersContract,
  createReviewContract,
  getReviewContract,
  listAiReviewRunsContract,
  listReviewsContract,
  requestAiReviewContract,
  updateReviewStatusContract,
} from '@sainte-beuve/contracts'
import { assertFound } from '@sainte-beuve/kernel'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { AiReviewService } from './AiReviewService.js'
import { ReviewService } from './ReviewService.js'

/** The review board API: track a pull request, route it, delegate it, resolve it. */
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

  // 202, not 201: cat-factory has accepted the task, and the verdict arrives later.
  buildHonoRoute(app, requestAiReviewContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    const { reviewId } = c.req.valid('param')
    return c.json(await service.request(reviewId, c.req.valid('json').instructions), 202)
  })

  buildHonoRoute(app, listAiReviewRunsContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    const { reviewId } = c.req.valid('param')
    return c.json({ runs: await service.listByReview(reviewId) }, 200)
  })

  return app
}
