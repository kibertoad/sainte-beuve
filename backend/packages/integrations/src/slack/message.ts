import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { boardReviewUrl } from '@sainte-beuve/contracts'
import { formatPullRequest } from '@sainte-beuve/kernel'
import { SLACK_ACTIONS } from './commands.js'

/**
 * How a review request reads in Slack. Pure, so the wording and the buttons are
 * testable without a workspace, and so the gateway stays about HTTP.
 *
 * `text` is set on every message even when blocks carry the content: it is what
 * a notification preview and a screen reader use, and a blocks-only message
 * arrives on a phone as the word "message".
 */

/** The minimum of Slack's block kit we emit. Widened only when a message needs it. */
export interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  elements?: unknown[]
}

export interface SlackMessage {
  text: string
  blocks?: SlackBlock[]
}

/**
 * Slack's `mrkdwn` control characters, escaped.
 *
 * Every message here carries third-party text: a pull-request title and a set of
 * labels, both typed by whoever opened the pull request. `<...>` is Slack's link
 * syntax, so a title of `<https://evil.example|Approve here>` would otherwise
 * render in the announcement channel as a link the bot appears to vouch for, and
 * `<!channel>` in one as a real broadcast ping. Slack asks for exactly these
 * three, in this order.
 */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * A Slack link with a safe label. The URL keeps its own escaping rules: `<`, `>`
 * and `|` inside it would end the link or start the label early, so they are
 * percent-encoded rather than entity-escaped.
 */
export function slackLink(url: string, label: string): string {
  return `<${url.replace(/[<>|]/g, (char) => encodeURIComponent(char))}|${escapeSlackText(label)}>`
}

/** `owner/repo#7 Title`, linked, with the skills the review needs. */
function reviewSummary(review: ReviewRequest): string {
  const link = slackLink(review.pullRequest.url, formatPullRequest(review.pullRequest))
  const skills =
    review.requiredSkills.length > 0
      ? ` (needs ${escapeSlackText(review.requiredSkills.join(', '))})`
      : ''
  return `${link} ${escapeSlackText(review.title)}${skills}`
}

/**
 * The announcement a new review request gets, with the three things somebody
 * reading it might want to do about it.
 *
 * The buttons carry the review id in their `value`, which is what the
 * interactivity route reads: a button is the same intent as the slash command it
 * saves typing, and both arrive at one handler.
 */
export function announcementMessage(review: ReviewRequest): SlackMessage {
  const text = `Review wanted: ${reviewSummary(review)}`
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'actions',
        elements: [
          button('I will take it', SLACK_ACTIONS.claim, review.id, 'primary'),
          button('Find someone else', SLACK_ACTIONS.reroll, review.id),
          button('Snooze a day', SLACK_ACTIONS.snooze, review.id),
        ],
      },
    ],
  }
}

/**
 * One scheduled nudge, worded by what the nudge is for.
 *
 * The parked AI review is the one that names the BOARD rather than the pull
 * request as the thing to open, because it is the one whose answer is not on the
 * pull request: nothing has been posted there yet, and the point of the loop is
 * that nothing is until somebody has said which findings deserve it.
 *
 * The board URL comes from `boardReviewPath` in the contracts rather than being
 * written here. It was written here, as `/reviews/<id>`, and the SPA has never
 * had that route: every nudge this deployment ever sent landed on an error page
 * with no way back, and the parked-review nudge — the one message whose whole
 * point is that the answer is NOT on the pull request — was the one it hurt
 * most.
 */
export function reminderMessage(
  reminder: Reminder,
  review: ReviewRequest,
  appBaseUrl: string | undefined,
): SlackMessage {
  const link = slackLink(review.pullRequest.url, formatPullRequest(review.pullRequest))
  const board = appBaseUrl === undefined ? '' : ` ${boardReviewUrl(appBaseUrl, review.id)}`
  if (reminder.kind === 'unassigned') {
    return { text: `${link} is still waiting for a reviewer.${board}` }
  }
  if (reminder.kind === 'escalation') {
    return { text: `${link} is past its review deadline.${board}` }
  }
  if (reminder.kind === 'ai_review_parked') {
    return {
      text:
        `The AI review of ${link} has finished and is waiting on somebody to say which ` +
        `findings are worth posting.${board}`,
    }
  }
  return { text: `Reminder: ${link} is waiting on your review.${board}` }
}

function button(
  label: string,
  actionId: string,
  value: string,
  style?: 'primary',
): Record<string, unknown> {
  return {
    type: 'button',
    text: { type: 'plain_text', text: label },
    action_id: actionId,
    value,
    ...(style === undefined ? {} : { style }),
  }
}
