import {
  askGuidedReviewContract,
  editGuidedReviewDraftContract,
  findGuidedReviewContract,
  getGuidedReviewContract,
  getGuidedReviewThreadContract,
  openGuidedReviewContract,
  openGuidedReviewThreadContract,
  postGuidedReviewDraftsContract,
  refreshGuidedReviewContract,
  requestGuidedReviewDraftsContract,
  streamGuidedReviewContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { GuidedReviewService } from './GuidedReviewService.js'
import { guidedReviewStream } from './guidedReviewStream.js'

/** cat-factory's guided review of a pull request. See `routes/guided-review.ts` in the contracts. */
export function guidedReviewController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, findGuidedReviewContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    return c.json({ session: await service.find(c.req.valid('query')) }, 200)
  })

  buildHonoRoute(app, openGuidedReviewContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    return c.json(await service.open(c.req.valid('json')), 200)
  })

  buildHonoRoute(app, getGuidedReviewContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    return c.json(await service.get(c.req.valid('param').sessionId), 200)
  })

  // The live half. A page that cannot hold it re-reads the session instead.
  buildHonoRoute(app, streamGuidedReviewContract, async (c) => {
    const container = c.get('container')
    const watched = await new GuidedReviewService(container).watch(c.req.valid('param').sessionId)
    return guidedReviewStream(watched, container.logger)
  })

  buildHonoRoute(app, refreshGuidedReviewContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    return c.json(await service.refresh(c.req.valid('param').sessionId), 200)
  })

  buildHonoRoute(app, openGuidedReviewThreadContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    const { sessionId } = c.req.valid('param')
    return c.json(await service.openThread(sessionId, c.req.valid('json')), 200)
  })

  buildHonoRoute(app, getGuidedReviewThreadContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    const { sessionId, threadId } = c.req.valid('param')
    return c.json(await service.getThread(sessionId, threadId), 200)
  })

  buildHonoRoute(app, askGuidedReviewContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    const { sessionId, threadId } = c.req.valid('param')
    return c.json(await service.ask(sessionId, threadId, c.req.valid('json')), 200)
  })

  buildHonoRoute(app, requestGuidedReviewDraftsContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    const { sessionId, threadId } = c.req.valid('param')
    return c.json(await service.requestDrafts(sessionId, threadId, c.req.valid('json')), 200)
  })

  mountDraftRoutes(app)

  return app
}

/** Editing and posting comment drafts: the half of the surface that reaches the pull request. */
function mountDraftRoutes(app: Hono<AppEnv>): void {
  buildHonoRoute(app, editGuidedReviewDraftContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    const { sessionId, draftId } = c.req.valid('param')
    return c.json(await service.editDraft(sessionId, draftId, c.req.valid('json')), 200)
  })

  buildHonoRoute(app, postGuidedReviewDraftsContract, async (c) => {
    const service = new GuidedReviewService(c.get('container'))
    const { sessionId } = c.req.valid('param')
    return c.json(await service.postDrafts(sessionId, c.req.valid('json')), 200)
  })
}
