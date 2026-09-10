import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { errorBody } from '../../http/errors.js'

/**
 * Inbound webhooks from GitHub and Slack.
 *
 * PLACEHOLDER: the routes exist, are mounted, and answer honestly; the handlers
 * are not wired to the services yet. They are here from the first commit because
 * their SHAPE is load-bearing for the deployment story: a GitHub App and a Slack
 * app both need a stable callback URL registered before anything can be tested
 * end to end, and adding a path later means re-registering both.
 *
 * Both routes read the RAW body, because both signature schemes are computed over
 * the exact bytes sent. Parsing first and re-serializing changes them.
 *
 * What lands here next (docs/implementation-plan.md, slice 3):
 *   - GitHub: `pull_request` opens/closes a review request, `pull_request_review`
 *     resolves it, `check_suite` gates the AI review trigger.
 *   - Slack: the `/review` slash command and the assign/snooze action buttons.
 */
export function webhookController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/webhooks/github', async (c) => {
    const rawBody = await c.req.text()
    c.get('container').logger.info(
      { event: c.req.header('X-GitHub-Event') ?? 'unknown', bytes: rawBody.length },
      'github webhook received (not yet handled)',
    )
    return c.json(errorBody('not_implemented', 'GitHub webhook intake is not wired yet'), 501)
  })

  app.post('/webhooks/slack', async (c) => {
    const rawBody = await c.req.text()
    c.get('container').logger.info(
      { bytes: rawBody.length },
      'slack webhook received (not yet handled)',
    )
    return c.json(errorBody('not_implemented', 'Slack interactivity is not wired yet'), 501)
  })

  return app
}
