import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { resolveAiReview, resolveChat, resolveVcs } from '../../integrations/resolve.js'

/**
 * `GET /health`: a liveness probe that also reports which optional capabilities
 * this deployment actually wired.
 *
 * The capability flags are here rather than in a separate admin route because the
 * question they answer ("why did that route 503?") is the first one an operator
 * asks, and a probe they can already reach is where they will look.
 *
 * They are RESOLVED rather than read off the container, which costs three
 * credential opens per probe and is the only honest answer: a credential entered
 * on the Configuration screen turns a capability on without a redeploy, so a flag
 * read from the process environment would report the deployment as it was
 * configured rather than as it is.
 *
 * The inbound flags are separate from the outbound ones. Posting to Slack needs a
 * bot token, and trusting a slash command needs the signing secret; a deployment
 * with one and not the other looks healthy on any single flag and is half wired.
 */
export function healthController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/health', async (c) => {
    const container = c.get('container')
    const [chat, vcs, aiReview] = await Promise.all([
      resolveChat(container),
      resolveVcs(container),
      resolveAiReview(container),
    ])
    return c.json({
      status: 'ok',
      capabilities: {
        chat: chat !== null,
        vcs: vcs !== null,
        aiReview: aiReview !== null,
        secrets: container.secrets !== null,
        githubWebhooks: container.github.webhookSecret !== null,
        slackInteractivity: container.slack.signingSecret !== null,
      },
    })
  })

  return app
}
