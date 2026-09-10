import { Hono } from 'hono'
import type { AppContainer } from '../../container.js'
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
    const [chat, github, gitlab, aiReview, persistenceReady] = await Promise.all([
      resolveChat(container),
      resolveVcs(container, 'github'),
      resolveVcs(container, 'gitlab'),
      resolveAiReview(container),
      storeAnswers(container),
    ])
    return c.json(
      {
        status: persistenceReady ? 'ok' : 'degraded',
        // Beside the capabilities rather than inside them, because it is not one:
        // every deployment has a store, and what an operator needs to know is
        // WHICH. `memory` is the honest answer for local mode and an alarm
        // anywhere else, and a deployment that thought it had wired D1 finds out
        // here rather than after an isolate recycle.
        persistence: container.persistence,
        persistenceReady,
        capabilities: {
          chat: chat !== null,
          // Per host, not one flag. A deployment connected to GitHub and not to
          // GitLab is exactly as healthy as its GitLab projects are unreadable,
          // and one boolean would report that as either fine or broken.
          vcs: { github: github !== null, gitlab: gitlab !== null },
          aiReview: aiReview !== null,
          secrets: container.secrets !== null,
          githubWebhooks: container.github.webhookSecret !== null,
          slackInteractivity: container.slack.signingSecret !== null,
        },
      },
      persistenceReady ? 200 : 503,
    )
  })

  return app
}

/**
 * Whether the store this process resolved actually answers.
 *
 * A READ, because the name beside it cannot tell an operator that much:
 * `persistence: "d1"` means a binding is there, and somebody who created the
 * database and skipped `db:migrate` has a binding that resolves and a board
 * that answers `no such table` on every route. Same on the Node side, where
 * `connectPostgres` builds a lazy pool and nothing connects until the first
 * query, so a wrong `DATABASE_URL` with `DATABASE_MIGRATE=false` boots quietly.
 *
 * `integrationTokens.list()` is the cheapest question that reaches the schema:
 * one table, one row per integration, four flat columns and no payload to
 * decode.
 *
 * A store that does not answer makes the probe 503 rather than a 200 with a
 * flag in it, because "do not send me traffic" is the answer every load
 * balancer already understands, and every route below this one is failing.
 */
async function storeAnswers(container: AppContainer): Promise<boolean> {
  try {
    await container.repositories.integrationTokens.list()
    return true
  } catch (err: unknown) {
    container.logger.error(
      { err, persistence: container.persistence },
      'the store did not answer the health probe',
    )
    return false
  }
}
