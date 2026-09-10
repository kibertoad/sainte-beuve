import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'

/**
 * `GET /health`: a liveness probe that also reports which optional capabilities
 * this deployment actually wired.
 *
 * The capability flags are here rather than in a separate admin route because the
 * question they answer ("why did that route 503?") is the first one an operator
 * asks, and a probe they can already reach is where they will look.
 */
export function healthController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/health', (c) => {
    const container = c.get('container')
    return c.json({
      status: 'ok',
      capabilities: {
        chat: container.chat !== null,
        vcs: container.vcs !== null,
        aiReview: container.aiReview !== null,
        secrets: container.secrets !== null,
      },
    })
  })

  return app
}
