import type { PullRequestRef, Reminder, ReviewRequest } from '@sainte-beuve/contracts'

/**
 * Outbound ports: the three systems sainte-beuve talks to. Each is OPTIONAL on the
 * container: a deployment with no Slack token has no chat gateway, and the route
 * that needs one answers 503 naming what is not configured, rather than failing
 * deep inside a service with a null read.
 */

/** Chat delivery (Slack today). */
export interface ChatGateway {
  /** Announce a new review request to the team channel. Returns the message id, for threading. */
  announceReview(review: ReviewRequest, channelId: string): Promise<{ messageId: string }>
  /** Deliver one scheduled nudge. `target` is a Slack user id for a DM, a channel id otherwise. */
  sendReminder(reminder: Reminder, review: ReviewRequest, target: string): Promise<void>
}

/** Source control (GitHub today). */
export interface VcsGateway {
  /** Mirror the assignment onto the pull request, so the VCS stays the source of truth. */
  requestReviewers(pr: PullRequestRef, logins: string[]): Promise<void>
  /** Post a nudge or an AI-review verdict as a pull-request comment. */
  comment(pr: PullRequestRef, body: string): Promise<void>
}

/** The handle a delegated AI review is tracked by. */
export interface AiReviewHandle {
  taskId: string
  /** Deep link into the cat-factory instance that accepted the task, when it gives one. */
  url: string | null
}

/** cat-factory, reached over the published `@cat-factory/sdk`. */
export interface AiReviewGateway {
  /** Hand a pull request to cat-factory. Resolves once the task is accepted, not once it runs. */
  requestReview(input: {
    pullRequest: PullRequestRef
    title: string
    instructions: string | null
  }): Promise<AiReviewHandle>
  /** Poll one delegated run. The Worker cron and the Node scheduler both drive this. */
  getStatus(taskId: string): Promise<{
    status: 'running' | 'completed' | 'failed' | 'cancelled'
    summary: string | null
  }>
}
