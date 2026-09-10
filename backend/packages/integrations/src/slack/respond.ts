import { UpstreamFailedError, getErrorMessage } from '@sainte-beuve/kernel'

/**
 * Answering an interaction on its own `response_url`.
 *
 * This is not the same channel as a slash command's reply, and the difference is
 * what makes it a separate function. Slack reads a message in the HTTP response
 * to a `block_actions` request as a REPLACEMENT for the message the button is
 * on, so answering a button that way overwrites the announcement, and with it
 * everybody else's buttons, with a note addressed to one person. The
 * `response_url` is the documented channel for a follow-up, and it carries
 * `response_type` faithfully, so an ephemeral answer stays ephemeral.
 *
 * It is also unauthenticated: the URL is the credential, it is valid for half an
 * hour, and it needs no bot token. That is what lets a deployment whose Slack
 * app has no `chat:write` still answer its own buttons.
 */
export interface SlackResponseMessage {
  response_type: 'ephemeral'
  text: string
}

export async function postSlackResponse(input: {
  responseUrl: string
  message: SlackResponseMessage
  /** Swap the HTTP implementation. Defaults to the global `fetch`. */
  fetchImpl?: typeof globalThis.fetch
}): Promise<void> {
  let response: Response
  try {
    response = await (input.fetchImpl ?? globalThis.fetch)(input.responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(input.message),
    })
  } catch (err) {
    throw new UpstreamFailedError(`Could not reach Slack: ${getErrorMessage(err)}`)
  }
  // A response URL answers with a plain status and `ok`/an error slug in the
  // body, not with the `{ ok: false }` envelope the Web API uses.
  if (!response.ok) {
    throw new UpstreamFailedError(`Slack refused the interaction reply: ${response.status}`)
  }
}
