import type { ReviewRequest } from '@sainte-beuve/contracts'
import { ForbiddenError, formatPullRequest, getErrorMessage } from '@sainte-beuve/kernel'
import type { SlackIntent } from '@sainte-beuve/integrations'
import { parseSlackRequest, verifySlackSignature } from '@sainte-beuve/integrations'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
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
 */

const NO_SECRET =
  'This deployment cannot verify Slack requests: set SLACK_SIGNING_SECRET to the signing secret ' +
  'from the Slack app configuration'

const HELP =
  'Try `/review` to list what is waiting, `/review take <id>` to put yourself on one, ' +
  '`/review reroll <id>` to hand it to somebody else, `/review snooze <id> [hours]` to defer ' +
  'the next nudge, or `/review ai <id>` to hand it to cat-factory.'

/** What Slack renders back to whoever asked. */
export interface SlackReply {
  response_type: 'ephemeral'
  text: string
}

export class SlackWebhookService {
  constructor(private readonly container: AppContainer) {}

  async handle(input: {
    rawBody: string
    timestamp: string | null
    signature: string | null
  }): Promise<SlackReply> {
    const secret = requireCapability(this.container.slack.signingSecret, NO_SECRET)
    const verified = await verifySlackSignature(
      secret,
      input.rawBody,
      { timestamp: input.timestamp, signature: input.signature },
      // The container's clock, not `Date.now()`: the replay window is behaviour,
      // so a suite has to be able to drive it rather than sign against real time.
      Math.floor(this.container.clock.now() / 1000),
    )
    if (!verified) throw new ForbiddenError('The Slack request signature did not match')

    const request = parseSlackRequest(new URLSearchParams(input.rawBody))
    // Slack posts other things to the same URL (its own URL verification, event
    // callbacks a workspace admin subscribed to). Answering them with help text
    // would be noise, so an unrecognised shape gets a bare ack.
    if (request === null) return ephemeral('')
    try {
      return ephemeral(await this.run(request.intent, request.userId))
    } catch (err) {
      // Slack shows the reply and nothing else, so a refusal has to be the reply.
      // A non-200 would render as "operation timed out" and lose the message that
      // says which configuration is missing.
      return ephemeral(`That did not work: ${getErrorMessage(err)}`)
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
    const result = await new ReviewService(this.container).assign(review.id, {
      count: 1,
      // A reroll must not hand the review back to whoever already has it, which
      // is the whole point of asking for one.
      excludeReviewerIds: review.assignedReviewerIds,
    })
    const names = result.assigned.map((reviewer) => reviewer.displayName).join(', ')
    return names.length === 0
      ? `Nobody else is available for ${describe(review)}.`
      : `${describe(review)} now goes to ${names}.`
  }

  /**
   * What is waiting, unassigned first. Capped, because a Slack message is
   * truncated somewhere the reader cannot see: a list that runs off the end looks
   * like a bug in the bot rather than a busy board.
   */
  private async list(): Promise<string> {
    const open = await this.container.repositories.reviews.list({
      status: ['open', 'assigned', 'in_review'],
    })
    if (open.length === 0) return 'Nothing is waiting for a review right now.'
    const lines = open
      .slice(0, 10)
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

function describe(review: ReviewRequest): string {
  return `<${review.pullRequest.url}|${formatPullRequest(review.pullRequest)}>`
}
