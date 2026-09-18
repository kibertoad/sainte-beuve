import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import {
  type ChatGateway,
  UpstreamFailedError,
  getErrorMessage,
  withDeadline,
} from '@sainte-beuve/kernel'
import { announcementMessage, reminderMessage, type SlackMessage } from './message.js'

/**
 * The Slack side of the chat port: announce a review, deliver a nudge.
 *
 * Plain `fetch` against Slack's Web API rather than `@slack/web-api`. Two
 * reasons, and the first one is not negotiable: the official client reaches for
 * `node:os` (through its instrumentation layer), which workerd does not provide,
 * so importing it makes the Worker bundle fail to load. The second is that the
 * surface we use is two POSTs of JSON, and a client that ships an HTTP stack,
 * retry policy and telemetry to cover them is a lot of dependency for
 * `chat.postMessage`.
 *
 * `@slack/bolt` is not the alternative: it owns a server and a socket, which is
 * the wrong shape for a Worker and duplicates the HTTP layer we already have on
 * Node. Interactivity arrives as plain signed POSTs to our own routes instead;
 * see `verifySlackSignature` and `parseSlackRequest`.
 */
export interface SlackGatewayOptions {
  botToken: string
  /** Base URL of the sainte-beuve UI, so a message can link back to the review. */
  appBaseUrl?: string
  /** Override the API origin. Only a test has a reason to. */
  apiBaseUrl?: string
  /** Swap the HTTP implementation. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch
}

/** Slack answers 200 with `{ ok: false, error }` for application-level failures. */
interface SlackResponse {
  ok: boolean
  error?: string
  ts?: string
}

const SLACK_API_BASE_URL = 'https://slack.com/api'

export class SlackChatGateway implements ChatGateway {
  private readonly options: SlackGatewayOptions
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: SlackGatewayOptions) {
    this.options = options
    // Deadlined at the transport: the reminder tick awaits a post per nudge
    // inside one invocation, so a Slack connection that is accepted and never
    // answered would hold up every nudge behind it.
    this.fetchImpl = withDeadline(options.fetch)
  }

  async announceReview(review: ReviewRequest, channelId: string): Promise<{ messageId: string }> {
    const result = await this.postMessage(channelId, announcementMessage(review))
    return { messageId: result.ts ?? '' }
  }

  async sendReminder(reminder: Reminder, review: ReviewRequest, target: string): Promise<void> {
    await this.postMessage(target, reminderMessage(reminder, review, this.options.appBaseUrl))
  }

  private async postMessage(channel: string, message: SlackMessage): Promise<SlackResponse> {
    const url = `${this.options.apiBaseUrl ?? SLACK_API_BASE_URL}/chat.postMessage`
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.botToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel, ...message }),
      })
    } catch (err) {
      throw new UpstreamFailedError(`Could not reach Slack: ${getErrorMessage(err)}`)
    }
    return this.readResult(response)
  }

  /**
   * Slack reports application failures as a 200 with `ok: false`, so the status
   * code alone is not the answer. Both halves are checked, and the `error` slug
   * (`channel_not_found`, `not_in_channel`) is carried through: it is the one
   * piece of the reply an operator can act on.
   */
  private async readResult(response: Response): Promise<SlackResponse> {
    if (!response.ok) {
      throw new UpstreamFailedError(`Slack answered ${response.status}`)
    }
    const body = (await response.json()) as SlackResponse
    if (!body.ok) {
      throw new UpstreamFailedError(`Slack refused the message: ${body.error ?? 'unknown error'}`)
    }
    return body
  }
}
