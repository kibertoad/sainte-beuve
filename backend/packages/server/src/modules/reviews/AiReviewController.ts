import {
  dismissAiReviewFindingContract,
  getAiReviewRunContract,
  listAiReviewRunsContract,
  requestAiReviewContract,
  resolveAiReviewContract,
  resumeAiReviewContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { AiReviewService } from './AiReviewService.js'

/**
 * The AI-review loop: hand a pull request to cat-factory, read what it found,
 * say which findings are worth a comment, put them on the pull request.
 *
 * Its own controller rather than four more routes on the board's, because the
 * two are addressed differently: the board is keyed on the review somebody
 * opened, and every verb past the first here is keyed on the delegated RUN, the
 * way cat-factory's own decision surface is. See `routes/ai-review.ts` in
 * @sainte-beuve/contracts.
 */
export function aiReviewController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // 202, not 201: cat-factory has accepted the task, and the findings arrive later.
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

  buildHonoRoute(app, getAiReviewRunContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    return c.json(await service.get(c.req.valid('param').runId), 200)
  })

  buildHonoRoute(app, dismissAiReviewFindingContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    const { runId, findingId } = c.req.valid('param')
    return c.json(await service.dismissFinding(runId, findingId), 200)
  })

  // 202 for both of these: cat-factory resolves and resumes ASYNCHRONOUSLY, so
  // what comes back is the instruction having been accepted rather than the
  // comments being up. The receipt arrives on a later read, as `postReport`.
  buildHonoRoute(app, resolveAiReviewContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    const { action, findingIds } = c.req.valid('json')
    return c.json(await service.resolve(c.req.valid('param').runId, { action, findingIds }), 202)
  })

  buildHonoRoute(app, resumeAiReviewContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    return c.json(await service.resume(c.req.valid('param').runId), 202)
  })

  return app
}
