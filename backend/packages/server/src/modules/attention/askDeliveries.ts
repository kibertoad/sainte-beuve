import type { AttentionDelivery, AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { matchTargetFor, scoreCandidate } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveChat } from '../../integrations/resolve.js'

/**
 * The chat DMs a named ask goes out as, and their updates as the ask moves on.
 *
 * Best effort throughout, like the announcement: the ask lives in the store and
 * the inbox whether or not Slack took the message, so a Slack outage or a
 * missing token costs the DM and nothing else. A failed post is a warning,
 * because it carries Slack's own slug and is usually a bot nobody let into a DM.
 * A store read failing on the way to Slack is caught too: by then the ask is
 * about to be written, or already was, and must not fail over its DMs.
 */

/**
 * DM each recipient who has a Slack id, and say where each message landed.
 * Recipients without one are skipped: the inbox still reaches them.
 */
export async function deliverAsk(
  container: AppContainer,
  request: AttentionRequest,
  recipients: readonly Reviewer[],
): Promise<AttentionDelivery[]> {
  const reachable = recipients.filter((reviewer) => reviewer.slackUserId !== null)
  if (reachable.length === 0) return []
  const reached = await quietly(container, request, async () => {
    const [chat, project] = await Promise.all([
      resolveChat(container),
      container.repositories.projects.getByRef(request.pullRequest),
    ])
    return chat === null ? null : { chat, target: matchTargetFor(request, project) }
  })
  if (reached === null) return []
  const { chat, target } = reached
  const sent = await Promise.allSettled(
    reachable.map(async (reviewer): Promise<AttentionDelivery> => {
      const { matchedSkills, matchedDomains } = scoreCandidate(reviewer, target)
      const notice = { request, recipientId: reviewer.id, matchedSkills, matchedDomains }
      const message = await chat.gateway.sendAttentionAsk(notice, reviewer.slackUserId ?? '')
      return { reviewerId: reviewer.id, ...message }
    }),
  )
  return sent.flatMap((outcome, index) => {
    if (outcome.status === 'fulfilled') return [outcome.value]
    container.logger.warn(
      { err: outcome.reason, attentionId: request.id, reviewerId: reachable.at(index)?.id },
      'could not DM an attention ask',
    )
    return []
  })
}

/**
 * Re-render the DMs of an ask that changed: every one of them when it resolved
 * or was withdrawn, or only `reviewerId`'s when they committed and it is still
 * open, since nobody else's message has anything new to say.
 */
export async function refreshAskDeliveries(
  container: AppContainer,
  request: AttentionRequest,
  reviewerId: string | null,
): Promise<void> {
  const due = request.chatDeliveries.filter(
    (delivery) => reviewerId === null || delivery.reviewerId === reviewerId,
  )
  if (due.length === 0) return
  const chat = await quietly(container, request, () => resolveChat(container))
  if (chat === null) return
  const updated = await Promise.allSettled(
    due.map((delivery) =>
      chat.gateway.updateAttentionAsk(
        { request, recipientId: delivery.reviewerId, matchedSkills: [], matchedDomains: [] },
        { conversationId: delivery.conversationId, messageId: delivery.messageId },
      ),
    ),
  )
  updated.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') return
    container.logger.warn(
      { err: outcome.reason, attentionId: request.id, reviewerId: due.at(index)?.reviewerId },
      'could not update the DM of an attention ask',
    )
  })
}

/** `read`'s answer, or null with a warning when it throws. */
async function quietly<T>(
  container: AppContainer,
  request: AttentionRequest,
  read: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    container.logger.warn(
      { err, attentionId: request.id },
      'could not reach chat for the DMs of an attention ask',
    )
    return null
  }
}
