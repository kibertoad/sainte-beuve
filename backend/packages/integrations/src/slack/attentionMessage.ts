import type { AttentionRequest } from '@sainte-beuve/contracts'
import { formatPullRequest, type AttentionAskNotice } from '@sainte-beuve/kernel'
import { SLACK_ACTIONS } from './commands.js'
import {
  button,
  escapeSlackText,
  slackLink,
  type SlackBlock,
  type SlackMessage,
} from './message.js'

/**
 * An attention ask as the DM one recipient gets, in whatever state the ask is
 * in now. Pure, like the announcement, so the wording is testable without a
 * workspace.
 *
 * The same function renders the first delivery and every later update. While
 * the ask is open and this person has not answered, it carries the commit
 * button; once they have, or once the ask is resolved or withdrawn, it says so
 * and carries none, so a button is never offered on an ask that is over.
 */
export function attentionAskMessage(
  notice: AttentionAskNotice,
  appBaseUrl: string | undefined,
): SlackMessage {
  const { request, recipientId } = notice
  const link = pullRequestLink(request)
  if (request.status === 'cancelled') {
    return closed(`${escapeSlackText(request.requestedByName)} withdrew the ask to review ${link}.`)
  }
  const committed = request.commitments.some((entry) => entry.reviewerId === recipientId)
  if (request.status === 'resolved') {
    const names = escapeSlackText(request.commitments.map((entry) => entry.displayName).join(', '))
    const thanks = committed ? ' Thanks for taking it.' : ''
    return closed(`${link} has its reviewers: ${names}.${thanks}`)
  }
  if (committed) {
    return closed(`You said you will review ${link}. It is on your workspace.`)
  }
  return openAsk(notice, link, appBaseUrl)
}

/** The ask itself, with the button that answers it. */
function openAsk(
  notice: AttentionAskNotice,
  link: string,
  appBaseUrl: string | undefined,
): SlackMessage {
  const { request } = notice
  const text =
    `${escapeSlackText(request.requestedByName)} asks you to review ` +
    `${link} ${escapeSlackText(request.title)}`
  const details = [
    request.note === null ? null : quoted(request.note),
    matchLine(notice),
    request.neededCommitments > 1 ? `${request.neededCommitments} reviewers wanted.` : null,
    appBaseUrl === undefined ? null : slackLink(appBaseUrl, 'Open your inbox'),
  ].filter((line): line is string => line !== null)
  const blocks: SlackBlock[] = [section(text)]
  if (details.length > 0) blocks.push(section(details.join('\n')))
  blocks.push({ type: 'actions', elements: askButtons(request) })
  return { text, blocks }
}

/**
 * The buttons an open ask offers. A list of one for now: a decline belongs
 * beside it, and goes here when the ask learns to record one.
 */
function askButtons(request: AttentionRequest): Record<string, unknown>[] {
  return [button('I will review it', SLACK_ACTIONS.attentionCommit, request.id, 'primary')]
}

/** Why this person was asked, from what they matched of what the ask wants. */
function matchLine(notice: AttentionAskNotice): string | null {
  const parts = [
    notice.matchedSkills.length === 0 ? null : `skills ${notice.matchedSkills.join(', ')}`,
    notice.matchedDomains.length === 0 ? null : `domains ${notice.matchedDomains.join(', ')}`,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : `You match on ${escapeSlackText(parts.join('; '))}.`
}

/** Every line prefixed, since a mrkdwn quote ends at the first line break and the note is a textarea. */
function quoted(note: string): string {
  return escapeSlackText(note)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function pullRequestLink(request: AttentionRequest): string {
  return slackLink(request.pullRequest.url, formatPullRequest(request.pullRequest))
}

function closed(text: string): SlackMessage {
  return { text, blocks: [section(text)] }
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}
