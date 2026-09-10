import { GITHUB_WEBHOOK_PATH, SLACK_WEBHOOK_PATH } from '@sainte-beuve/contracts'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { GitHubWebhookService } from './GitHubWebhookService.js'
import { SlackWebhookService } from './SlackWebhookService.js'

/**
 * Inbound webhooks from GitHub and Slack.
 *
 * Both routes read the RAW body, because both signature schemes are computed
 * over the exact bytes sent and parsing first re-serialises them. That is the
 * only thing this controller does beyond handing over: the verification, the
 * interpretation and the writes belong to the two services, so the shape of a
 * refusal is decided in one place with every other error.
 *
 * They sit OUTSIDE `/api/v1`: their URLs are registered in a GitHub App and a
 * Slack app by hand, so they have to survive an API version bump.
 */
export function webhookController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post(GITHUB_WEBHOOK_PATH, async (c) => {
    const outcome = await new GitHubWebhookService(c.get('container')).handle({
      event: c.req.header('X-GitHub-Event') ?? 'unknown',
      rawBody: await c.req.text(),
      signature: c.req.header('X-Hub-Signature-256') ?? null,
    })
    // 202, not 200: what the delivery asked for has been done, and GitHub's
    // delivery log is not the place to read a review board out of. The outcome
    // rides along because it is what makes a redelivery from that log legible.
    return c.json(outcome, 202)
  })

  app.post(SLACK_WEBHOOK_PATH, async (c) => {
    const reply = await new SlackWebhookService(c.get('container')).handle({
      rawBody: await c.req.text(),
      timestamp: c.req.header('X-Slack-Request-Timestamp') ?? null,
      signature: c.req.header('X-Slack-Signature') ?? null,
    })
    // A null reply is an ack with an EMPTY body, and that is load-bearing rather
    // than tidy: for a button press Slack treats a message here as a replacement
    // for the message the button is on, so the service answers those on the
    // interaction's `response_url` and leaves nothing for this to render.
    return reply === null ? c.body(null, 200) : c.json(reply, 200)
  })

  return app
}
