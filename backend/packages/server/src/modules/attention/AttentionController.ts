import {
  cancelAttentionContract,
  commitToAttentionContract,
  commitToPullRequestContract,
  listAttentionContract,
  releaseCommitmentContract,
  requestAttentionContract,
  streamAttentionContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppContainer } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { sseStream } from '../../realtime/sse.js'
import { ViewerService } from '../identity/ViewerService.js'
import { AttentionService, reaches } from './AttentionService.js'

/**
 * Asking for attention, and answering.
 *
 * Every route resolves the viewer first, because who is asking decides what
 * the answer contains: the inbox is filtered by the audience gate, a
 * commitment is recorded against a person, and only the requester may
 * withdraw. Until sessions land (docs/implementation-plan.md, slice 6) the
 * viewer is whoever this deployment's source-control credential acts as, which
 * is what `ViewerService` resolves.
 */
export function attentionController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listAttentionContract, async (c) => {
    const container = c.get('container')
    const viewer = await new ViewerService(container).current()
    const requests = await new AttentionService(container).inbox(viewer.reviewer)
    return c.json({ requests }, 200)
  })

  // The live half. The REST inbox above is the one that is correct on every
  // runtime; this is the optimisation that makes a page already open react.
  buildHonoRoute(app, streamAttentionContract, async (c) => {
    return openStream(c.get('container'))
  })

  buildHonoRoute(app, requestAttentionContract, async (c) => {
    const container = c.get('container')
    const viewer = await new ViewerService(container).current()
    const request = await new AttentionService(container).raise(
      viewer.reviewer,
      c.req.valid('json'),
    )
    return c.json(request, 201)
  })

  buildHonoRoute(app, commitToAttentionContract, async (c) => {
    const container = c.get('container')
    const viewer = await new ViewerService(container).current()
    const { attentionId } = c.req.valid('param')
    return c.json(await new AttentionService(container).commit(viewer.reviewer, attentionId), 200)
  })

  buildHonoRoute(app, cancelAttentionContract, async (c) => {
    const container = c.get('container')
    const viewer = await new ViewerService(container).current()
    const { attentionId } = c.req.valid('param')
    return c.json(await new AttentionService(container).cancel(viewer.reviewer, attentionId), 200)
  })

  buildHonoRoute(app, commitToPullRequestContract, async (c) => {
    const container = c.get('container')
    const viewer = await new ViewerService(container).current()
    const service = new AttentionService(container)
    return c.json(await service.commitToPullRequest(viewer.reviewer, c.req.valid('json')), 201)
  })

  buildHonoRoute(app, releaseCommitmentContract, async (c) => {
    const container = c.get('container')
    const viewer = await new ViewerService(container).current()
    const { commitmentId } = c.req.valid('param')
    const service = new AttentionService(container)
    return c.json({ commitments: await service.release(viewer.reviewer, commitmentId) }, 200)
  })

  return app
}

/**
 * The viewer is resolved BEFORE the stream opens, so a deployment that cannot
 * say who is looking answers 503 with the reason instead of holding a
 * connection open that will never carry anything.
 */
async function openStream(container: AppContainer): Promise<Response> {
  const viewer = await new ViewerService(container).current()
  return sseStream({
    eventName: 'attention',
    subscribe: (emit) =>
      container.bus.subscribe((event) => {
        if (reaches(event, viewer.reviewer)) emit(event)
      }),
  })
}
