import {
  DEFAULT_ORG_SLUG,
  GITHUB_WEBHOOK_PATH,
  SLACK_ORG_WEBHOOK_PATH,
  SLACK_WEBHOOK_PATH,
} from '@sainte-beuve/contracts'
import type { SlackSignatureHeaders } from '@sainte-beuve/integrations'
import { readSlackSignatureHeaders } from '@sainte-beuve/integrations'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { type AppContainer, withOrg } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { OrgService } from '../orgs/OrgService.js'
import { GitHubWebhookService } from './GitHubWebhookService.js'
import type { SlackIntake } from './SlackWebhookService.js'
import { SlackWebhookService, unverifiedSlackRequest } from './SlackWebhookService.js'

/**
 * Inbound webhooks from GitHub and Slack.
 *
 * Both routes read the RAW body, because both signature schemes are computed
 * over the exact bytes sent and parsing first re-serialises them. Beyond that
 * this controller places the delivery in an org and, on the Slack routes, takes
 * the one step of verification that needs NO secret — that the signature headers
 * are there and fresh — because everything after it costs a store read or a
 * decrypt on a path any stranger can POST to. Checking the signature itself,
 * interpreting the delivery and the writes belong to the two services, so the
 * shape of a refusal is decided in one place with every other error.
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
  app.post(SLACK_WEBHOOK_PATH, async (c) => {
    const signed = signedHeaders(c)
    if (signed === null) throw unverified(c, 'the request carried no usable Slack signature')
    // `namedInUrl: false`: nobody named a tenancy here, so a refusal may name the
    // deployment variable that is missing. See `SlackIntake`.
    return slackReply(
      c,
      c.get('container'),
      { orgSlug: DEFAULT_ORG_SLUG, namedInUrl: false },
      signed,
    )
  })

  // One named org's URL, where every refusal before a verified signature is the
  // SAME refusal. A 404 for a slug nobody has made would let an anonymous POST
  // enumerate this deployment's tenancies one guess at a time, and the signature
  // check is no answer to that: it runs after the slug has been looked up. So an
  // unknown slug, an org with no secret stored and a signature that does not
  // match are one 403 with one body (see `unverifiedSlackRequest`), and which of
  // the three it was goes to the log.
  //
  // What that does not equalise is TIMING — an unknown slug costs one store read
  // and a verified one costs two plus a decrypt — and closing that would mean
  // opening a credential for an org that does not exist. The status code was the
  // channel worth closing.
  app.post(SLACK_ORG_WEBHOOK_PATH, async (c) => {
    const signed = signedHeaders(c)
    if (signed === null) throw unverified(c, 'the request carried no usable Slack signature')
    const org = await new OrgService(c.get('container')).bySlugOrNull(c.req.param('org'))
    if (org === null) throw unverified(c, 'the URL named an org this deployment does not hold')
    return slackReply(
      c,
      withOrg(c.get('container'), org.id),
      { orgSlug: org.slug, namedInUrl: true },
      signed,
    )
  })

  return app
}

/**
 * The headers Slack signs with, BEFORE anything is read or resolved.
 *
 * First because of what comes after it. Placing the delivery is a store read and
 * opening this org's signing secret is another plus an HKDF derivation and an
 * AES-GCM open, on a route that is unauthenticated by construction — so a POST
 * with no signature, or one replayed from last week, would otherwise buy a
 * stranger two queries and a decrypt for nothing. It also leaves the body
 * unread, which is the other thing a flood is made of.
 *
 * The container's clock rather than `Date.now()`, for the reason the service
 * gives: the replay window is behaviour, and a suite has to drive it.
 */
function signedHeaders(c: Context<AppEnv>): SlackSignatureHeaders | null {
  return readSlackSignatureHeaders(
    {
      timestamp: c.req.header('X-Slack-Request-Timestamp') ?? null,
      signature: c.req.header('X-Slack-Signature') ?? null,
    },
    Math.floor(c.get('container').clock.now() / 1000),
  )
}

/** The one refusal, with the reason it really was kept to the log. */
function unverified(c: Context<AppEnv>, reason: string): Error {
  c.get('container').logger.debug({ path: c.req.path, reason }, 'refused a Slack delivery')
  return unverifiedSlackRequest()
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
  intake: SlackIntake,
  signed: SlackSignatureHeaders,
): Promise<Response> {
  const reply = await new SlackWebhookService(container, intake).handle({
    rawBody: await c.req.text(),
    signed,
  })
  return reply === null ? c.body(null, 200) : c.json(reply, 200)
}
