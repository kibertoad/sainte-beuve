import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
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

/** `owner/repo#7 Title`, linked, with the skills the review needs. */
function reviewSummary(review: ReviewRequest): string {
  const link = `<${review.pullRequest.url}|${formatPullRequest(review.pullRequest)}>`
  const skills =
    review.requiredSkills.length > 0 ? ` (needs ${review.requiredSkills.join(', ')})` : ''
  return `${link} ${review.title}${skills}`
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

/** One scheduled nudge, worded by what the nudge is for. */
export function reminderMessage(
  reminder: Reminder,
  review: ReviewRequest,
  appBaseUrl: string | undefined,
): SlackMessage {
  const link = `<${review.pullRequest.url}|${formatPullRequest(review.pullRequest)}>`
  const board = appBaseUrl === undefined ? '' : ` ${appBaseUrl}/reviews/${review.id}`
  if (reminder.kind === 'unassigned') {
    return { text: `${link} is still waiting for a reviewer.${board}` }
  }
  if (reminder.kind === 'escalation') {
    return { text: `${link} is past its review deadline.${board}` }
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
