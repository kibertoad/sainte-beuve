import {
  type AiReviewRun,
  challengeAiReviewFindingContract,
  dismissAiReviewFindingContract,
  getAiReviewRunContract,
  listAiReviewRunsContract,
  requestAiReviewContract,
  requestPullRequestAiReviewContract,
  resolveAiReviewContract,
  resumeAiReviewContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppContainer } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { AiReviewCurationService } from './AiReviewCurationService.js'
import { AiReviewService } from './AiReviewService.js'
import { withCatFactoryLink, withCatFactoryLinks } from './catFactoryLinks.js'
import { requestPullRequestAiReview } from './pullRequestAiReview.js'

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
  mountFilingAndReads(app)
  mountCuration(app)
  return app
}

/** A run as a route answers it, with its link into cat-factory built now (see `withCatFactoryLinks`). */
type Linked = (run: Promise<AiReviewRun>) => Promise<AiReviewRun>

function linking(container: AppContainer): Linked {
  return async (run) => withCatFactoryLink(container, await run)
}

function mountFilingAndReads(app: Hono<AppEnv>): void {
  // 202, not 201: cat-factory has accepted the task, and the findings arrive later.
  buildHonoRoute(app, requestAiReviewContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    const { reviewId } = c.req.valid('param')
    const run = service.request(reviewId, c.req.valid('json').instructions)
    return c.json(await linking(c.get('container'))(run), 202)
  })

  // The same filing from a row that is not on the board yet: the workspace, My
  // PRs and My Reviews. The run names the board row it was filed on.
  buildHonoRoute(app, requestPullRequestAiReviewContract, async (c) => {
    const run = requestPullRequestAiReview(c.get('container'), c.req.valid('json'))
    return c.json(await linking(c.get('container'))(run), 202)
  })

  buildHonoRoute(app, listAiReviewRunsContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    const { reviewId } = c.req.valid('param')
    const runs = await withCatFactoryLinks(c.get('container'), await service.listByReview(reviewId))
    return c.json({ runs }, 200)
  })

  buildHonoRoute(app, getAiReviewRunContract, async (c) => {
    const service = new AiReviewService(c.get('container'))
    return c.json(await linking(c.get('container'))(service.get(c.req.valid('param').runId)), 200)
  })
}

function mountCuration(app: Hono<AppEnv>): void {
  buildHonoRoute(app, dismissAiReviewFindingContract, async (c) => {
    const service = new AiReviewCurationService(c.get('container'))
    const { runId, findingId } = c.req.valid('param')
    return c.json(await linking(c.get('container'))(service.dismissFinding(runId, findingId)), 200)
  })

  // 202 for the three below: cat-factory challenges, resolves and resumes
  // ASYNCHRONOUSLY, so what comes back is the instruction having been accepted
  // rather than the verdict or the comments. Those arrive on a later read.
  buildHonoRoute(app, challengeAiReviewFindingContract, async (c) => {
    const service = new AiReviewCurationService(c.get('container'))
    const { runId, findingId } = c.req.valid('param')
    const run = service.challenge(runId, findingId, c.req.valid('json').question)
    return c.json(await linking(c.get('container'))(run), 202)
  })

  buildHonoRoute(app, resolveAiReviewContract, async (c) => {
    const service = new AiReviewCurationService(c.get('container'))
    const { action, findingIds } = c.req.valid('json')
    const run = service.resolve(c.req.valid('param').runId, { action, findingIds })
    return c.json(await linking(c.get('container'))(run), 202)
  })

  buildHonoRoute(app, resumeAiReviewContract, async (c) => {
    const service = new AiReviewCurationService(c.get('container'))
    return c.json(
      await linking(c.get('container'))(service.resume(c.req.valid('param').runId)),
      202,
    )
  })
}
