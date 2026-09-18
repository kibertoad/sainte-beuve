import { ACTIVE_REVIEW_STATUSES, type ReviewRequest } from '@sainte-beuve/contracts'
import {
  ForbiddenError,
  formatPullRequest,
  getErrorMessage,
  UnavailableError,
} from '@sainte-beuve/kernel'
import type { SlackIntent, SlackRequest, SlackSignatureHeaders } from '@sainte-beuve/integrations'
import {
  parseSlackRequest,
  postSlackResponse,
  slackLink,
  verifySlackSignature,
} from '@sainte-beuve/integrations'
import type { AppContainer } from '../../container.js'
import { resolveSlackSigningSecret } from '../../integrations/resolve.js'
import { snoozeReview } from '../../reminders/snooze.js'
import { AiReviewService } from '../reviews/AiReviewService.js'
import { ReviewService } from '../reviews/ReviewService.js'

/**
 * The `/review` slash command and the announcement message's buttons.
 *
 * Both arrive as signed, form-encoded POSTs to one route, which is what makes
 * this the whole Slack inbound surface: no socket, no Bolt, no second server.
 * The signature is checked over the RAW body first, because Slack signs the
 * bytes, and because `URLSearchParams` re-encoding them changes them.
 *
 * Every answer is EPHEMERAL. A slash command's reply is addressed to the person
 * who typed it, and a channel does not need to see somebody's typo, nor a second
 * copy of a message the bot is about to post properly.
 *
 * WHERE the answer goes differs by surface, and it is not a detail: a slash
 * command is answered in the HTTP response, while a button press is answered on
 * the interaction's own `response_url`, because Slack reads a message in the
 * response to a `block_actions` request as a replacement for the message the
 * button is on.
 */

/**
 * WHICH ORG a command lands in is decided before this service is built, by the
 * slug in the URL the Slack app posts to, and the org's OWN signing secret is
 * what makes that placement true.
 *
 * A GitHub delivery names a repository, and the project registry says which
 * tenancy claimed it. A slash command names a Slack user and a channel, and
 * nothing in the body places either: searching every org's directory for the
 * Slack id would be a read across the boundary on an unauthenticated path, and
 * would answer ambiguously for anybody who is in two. So the org is named in the
 * path, which is safe for the one reason that matters here — a stranger can
 * write any slug and cannot produce a signature that verifies against the secret
 * that slug selects. Naming the wrong org refuses; it does not admit.
 *
 * The container this is built with is therefore already bound (see
 * `WebhookController`), and everything below reads `this.container` exactly as
 * it did when there was only the default org. See docs/orgs.md.
 */

const NO_SECRET =
  'This deployment cannot verify Slack requests: set SLACK_SIGNING_SECRET to the signing secret ' +
  'from the Slack app configuration, or store it on the Configuration screen'

/**
 * The ONE refusal a delivery gets when it has not been verified, whatever
 * stopped it.
 *
 * Shared with `WebhookController` rather than written twice, because its value
 * is entirely in the two being identical: on the URL that names an org, a
 * signature that does not match, an org with no secret stored and a slug nobody
 * has made must be one answer, or an anonymous POST can read this deployment's
 * tenancy list off the status code. Whichever it was is logged where an operator
 * can see it and a stranger cannot.
 */
export function unverifiedSlackRequest(): ForbiddenError {
  return new ForbiddenError('The Slack request signature did not match')
}

/** Which URL a delivery arrived on, and therefore what a refusal is allowed to say. */
export interface SlackIntake {
  /** The org it was placed in. For the log, and for a refusal that may name it. */
  orgSlug: string
  /**
   * Whether the CALLER named that org, which is the whole of what decides
   * whether "no signing secret here" may be said out loud.
   *
   * On the bare path nobody named anything: the org is the default one by
   * construction, its secret is a deployment variable, and the operator reading
   * the 503 is the only person who can act on it. On the org path the same
   * sentence is an oracle, so it becomes {@link unverifiedSlackRequest} and the
   * org's own Configuration screen — which is authenticated — is where that org
   * finds out it has nothing stored.
   */
  namedInUrl: boolean
}

const HELP =
  'Try `/review` to list what is waiting, `/review take <id>` to put yourself on one, ' +
  '`/review reroll <id>` to hand it to somebody else, `/review snooze <id> [hours]` to defer ' +
  'the next nudge, or `/review ai <id>` to hand it to cat-factory.'

/** What Slack renders back to whoever asked. */
export interface SlackReply {
  response_type: 'ephemeral'
  text: string
}

/** How many reviews one Slack message lists before it says how many are left. */
const LIST_LIMIT = 10

export class SlackWebhookService {
  /**
   * The container is ALREADY BOUND to the org this delivery named, and the
   * intake says how it got there. Both come from `WebhookController`, which is
   * the one place the path is read — and which has already established that the
   * request carries a signature worth spending a credential on.
   */
  constructor(
    private readonly container: AppContainer,
    private readonly intake: SlackIntake,
  ) {}

  /** This org's secret, or the deployment's when this org is the default one. */
  private async signingSecret(): Promise<string | null> {
    return (await resolveSlackSigningSecret(this.container))?.secret ?? null
  }

  /**
   * Nothing to verify against. Which sentence that is, is the intake's decision
   * rather than this one's: see {@link SlackIntake.namedInUrl}.
   */
  private cannotVerify(): Error {
    if (!this.intake.namedInUrl) return new UnavailableError(NO_SECRET)
    this.container.logger.warn(
      { org: this.intake.orgSlug },
      'a Slack delivery named an org with no signing secret stored, and was refused',
    )
    return unverifiedSlackRequest()
  }

  async handle(input: {
    rawBody: string
    signed: SlackSignatureHeaders
  }): Promise<SlackReply | null> {
    const secret = await this.signingSecret()
    if (secret === null) throw this.cannotVerify()
    const verified = await verifySlackSignature(
      secret,
      input.rawBody,
      input.signed,
      // The container's clock, not `Date.now()`: the replay window is behaviour,
      // so a suite has to be able to drive it rather than sign against real time.
      Math.floor(this.container.clock.now() / 1000),
    )
    if (!verified) throw unverifiedSlackRequest()

    const request = parseSlackRequest(new URLSearchParams(input.rawBody))
    // Slack posts other things to the same URL (its own URL verification, event
    // callbacks a workspace admin subscribed to). Answering them with help text
    // would be noise, so an unrecognised shape gets a bare ack.
    if (request === null) return ephemeral('')
    const reply = ephemeral(await this.answer(request))
    if (request.surface === 'command') return reply
    if (request.responseUrl === null) {
      // An interaction is NEVER answered in the HTTP response, not even when
      // Slack sent no URL to answer on: overwriting the announcement everybody
      // is looking at is worse than one person seeing no confirmation.
      this.container.logger.warn(
        { intent: request.intent.kind },
        'a Slack interaction carried no response_url, so its reply had nowhere to go',
      )
      return null
    }
    await this.followUp(request.responseUrl, reply)
    return null
  }

  private async answer(request: SlackRequest): Promise<string> {
    try {
      return await this.run(request.intent, request.userId)
    } catch (err) {
      // Slack shows the reply and nothing else, so a refusal has to be the reply.
      // A non-200 would render as "operation timed out" and lose the message that
      // says which configuration is missing.
      return `That did not work: ${getErrorMessage(err)}`
    }
  }

  /** Best-effort: the work is committed, and a reply that failed must not undo it. */
  private async followUp(responseUrl: string, reply: SlackReply): Promise<void> {
    try {
      await postSlackResponse({ responseUrl, message: reply })
    } catch (err) {
      this.container.logger.warn(
        { err },
        'could not answer a Slack interaction on its response URL',
      )
    }
  }

  private async run(intent: SlackIntent, slackUserId: string): Promise<string> {
    if (intent.kind === 'help') return HELP
    if (intent.kind === 'list') return this.list()
    const review = await this.require(intent.reviewId)
    if (intent.kind === 'claim') return this.claim(review, slackUserId)
    if (intent.kind === 'snooze') return this.snooze(review, intent.hours)
    if (intent.kind === 'ai_review') {
      const run = await new AiReviewService(this.container).request(review.id, null)
      return `Handed ${describe(review)} to cat-factory (${run.status}).`
    }
    // A reroll takes the review OFF whoever has it, which is the whole point of
    // asking for one, and leaves it with them when there is nobody else.
    const result = await new ReviewService(this.container).reroll(review.id)
    const names = result.assigned.map((reviewer) => reviewer.displayName).join(', ')
    return names.length === 0
      ? `Nobody else is available for ${describe(review)}, so it stays where it is.`
      : `${describe(review)} now goes to ${names}.`
  }

  /**
   * What is waiting, unassigned first. Capped, because a Slack message is
   * truncated somewhere the reader cannot see: a list that runs off the end looks
   * like a bug in the bot rather than a busy board.
   *
   * The ORDER is what makes the cap safe. The store answers newest-first, so a
   * busy board would push the reviews nobody is on off the end, which are
   * exactly the ones somebody reading `/review` can do something about.
   */
  private async list(): Promise<string> {
    const open = await this.container.repositories.reviews.list({
      status: [...ACTIVE_REVIEW_STATUSES],
    })
    if (open.length === 0) return 'Nothing is waiting for a review right now.'
    const lines = [...open]
      .sort(byNeedForAReviewer)
      .slice(0, LIST_LIMIT)
      .map((review) => `- \`${review.id}\` ${describe(review)} (${review.status})`)
    const more = open.length > lines.length ? `\n...and ${open.length - lines.length} more.` : ''
    return `${lines.join('\n')}${more}`
  }

  /**
   * "I will take it". The Slack user id is mapped to a reviewer row, and a
   * mapping that is missing is the answer rather than a failure: it is the state
   * every fresh deployment is in, and it names the field to fill in.
   */
  private async claim(review: ReviewRequest, slackUserId: string): Promise<string> {
    const reviewers = await this.container.repositories.reviewers.list()
    const reviewer = reviewers.find((candidate) => candidate.slackUserId === slackUserId)
    if (reviewer === undefined) {
      return (
        'You are not in the reviewer pool under this Slack id yet. Add your Slack user id ' +
        `(\`${slackUserId}\`) to your reviewer entry, and I can put you on reviews from here.`
      )
    }
    await new ReviewService(this.container).claim(review.id, reviewer.id)
    return `${describe(review)} is yours.`
  }

  private async snooze(review: ReviewRequest, hours: number): Promise<string> {
    const reminder = await snoozeReview(this.container, review, hours)
    const when = new Date(reminder.dueAt).toISOString()
    return `Snoozed ${describe(review)}. The next nudge is due at ${when}.`
  }

  private async require(reviewId: string): Promise<ReviewRequest> {
    const review = await this.container.repositories.reviews.getById(reviewId)
    if (review === null) {
      // Not a NotFoundError: this becomes the text of a Slack reply, and "No
      // review request rev-9" reads better than a 404 rendered as a failure.
      throw new Error(
        `there is no review \`${reviewId}\` on the board. Try \`/review\` to list them.`,
      )
    }
    return review
  }
}

function ephemeral(text: string): SlackReply {
  return { response_type: 'ephemeral', text }
}

/** Escaped, because `owner/repo` is a third party's name and `<` is Slack syntax. */
function describe(review: ReviewRequest): string {
  return slackLink(review.pullRequest.url, formatPullRequest(review.pullRequest))
}

/**
 * Unassigned first, then the longest-waiting. Both halves answer the same
 * question ("what needs somebody?"), and the second is what puts a review that
 * has been sitting for a week above one opened this morning.
 */
function byNeedForAReviewer(left: ReviewRequest, right: ReviewRequest): number {
  const unassigned = Number(left.assignedReviewerIds.length === 0)
  const otherUnassigned = Number(right.assignedReviewerIds.length === 0)
  return unassigned === otherUnassigned
    ? left.createdAt - right.createdAt
    : otherUnassigned - unassigned
}
