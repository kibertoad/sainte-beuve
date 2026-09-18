import {
  DEFAULT_ORG_SLUG,
  GITHUB_WEBHOOK_PATH,
  SLACK_ORG_WEBHOOK_PATH,
  SLACK_WEBHOOK_PATH,
} from '@sainte-beuve/contracts'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { type AppContainer, withOrg } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { OrgService } from '../orgs/OrgService.js'
import { GitHubWebhookService } from './GitHubWebhookService.js'
import { SlackWebhookService } from './SlackWebhookService.js'

/**
 * Inbound webhooks from GitHub and Slack.
 *
 * Both routes read the RAW body, because both signature schemes are computed
 * over the exact bytes sent and parsing first re-serialises them. That is the
 * only thing this controller does beyond handing over and placing the delivery
 * in an org: the verification, the interpretation and the writes belong to the
 * two services, so the shape of a refusal is decided in one place with every
 * other error.
 *
 * They sit OUTSIDE `/api/v1`: their URLs are registered in a GitHub App and a
 * Slack app by hand, so they have to survive an API version bump.
 *
 * WHICH ORG each lands in is answered differently, because the two deliveries
 * carry different facts. A GitHub delivery names a repository and the project
 * registry says which tenancy claimed it, so `GitHubWebhookService` places
 * itself. A Slack command names a Slack user and a channel, which place nothing,
 * so the org is in the URL its app posts to — and the org's own signing secret,
 * which the service then verifies against, is what makes naming it safe.
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

  // The default org's URL, and the one every deployment configured before the
  // intake knew about tenancies. It stays a route of its own rather than being
  // folded into the pattern below so that such a deployment needs no change in
  // Slack: the container a facade builds is already bound to the default org.
  app.post(SLACK_WEBHOOK_PATH, async (c) => slackReply(c, c.get('container'), DEFAULT_ORG_SLUG))

  // One named org's URL. A slug nobody has made is a 404 (see `OrgService.bySlug`),
  // which is a fact about this deployment that a stranger can also learn from the
  // sign-in route, and one the signature check below it is not a substitute for.
  app.post(SLACK_ORG_WEBHOOK_PATH, async (c) => {
    const slug = c.req.param('org')
    const org = await new OrgService(c.get('container')).bySlug(slug)
    return slackReply(c, withOrg(c.get('container'), org.id), org.slug)
  })

  return app
}

/**
 * The Slack half of both routes: one service call, and one rule for what comes
 * back.
 *
 * A null reply is an ack with an EMPTY body, and that is load-bearing rather
 * than tidy: for a button press Slack treats a message here as a replacement for
 * the message the button is on, so the service answers those on the
 * interaction's `response_url` and leaves nothing for this to render.
 */
async function slackReply(
  c: Context<AppEnv>,
  container: AppContainer,
  orgSlug: string,
): Promise<Response> {
  const reply = await new SlackWebhookService(container, orgSlug).handle({
    rawBody: await c.req.text(),
    timestamp: c.req.header('X-Slack-Request-Timestamp') ?? null,
    signature: c.req.header('X-Slack-Signature') ?? null,
  })
  return reply === null ? c.body(null, 200) : c.json(reply, 200)
}
