import type { AttentionDelivery, AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { matchTargetFor, matchesOf } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveChat } from '../../integrations/resolve.js'

/**
 * The chat DMs a named ask goes out as, and their updates as the ask moves on.
 *
 * Best effort throughout, like the announcement: the ask lives in the store and
 * the inbox whether or not Slack took the message, so a Slack outage or a
 * missing token costs the DM and nothing else. A failed post is a warning,
 * because it carries Slack's own slug and is usually a bot nobody let into a DM.
 * A store read or write failing on the way to Slack is caught too: by then
 * the ask is already stored, and must not fail over its DMs.
 */

/**
 * DM the recipients of an ask that is already stored, record where the messages
 * landed, and answer with the ask as it then stands.
 *
 * The row comes first so a button never points at an ask the store does not
 * hold yet. A commit that lands while the DMs are in flight is not lost either:
 * the store merges the two writes, and whichever comes second sees the other,
 * so either the commit refreshes the recorded DMs or this does.
 */
export async function sendAskDms(
  container: AppContainer,
  request: AttentionRequest,
  recipients: readonly Reviewer[],
): Promise<AttentionRequest> {
  const chatDeliveries = await deliverAsk(container, request, recipients)
  if (chatDeliveries.length === 0) return request
  let recorded: AttentionRequest | null
  try {
    recorded = await container.repositories.attention.update(request.id, { chatDeliveries })
  } catch (err) {
    container.logger.warn({ err, attentionId: request.id }, 'could not record the DMs of an ask')
    return request
  }
  if (recorded === null) return request
  await refreshDeliveries(container, recorded, recorded.chatDeliveries.filter(isStale(recorded)))
  return recorded
}

/**
 * DM each recipient who has a Slack id, and say where each message landed.
 * Recipients without one are skipped: the inbox still reaches them.
 */
async function deliverAsk(
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
      const { matchedSkills, matchedDomains } = matchesOf(reviewer, target)
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
  await refreshDeliveries(container, request, due)
}

/** Whether a DM no longer says what the ask says: it closed, or this recipient committed. */
function isStale(request: AttentionRequest): (delivery: AttentionDelivery) => boolean {
  return (delivery) =>
    request.status !== 'open' ||
    request.commitments.some((entry) => entry.reviewerId === delivery.reviewerId)
}

async function refreshDeliveries(
  container: AppContainer,
  request: AttentionRequest,
  due: readonly AttentionDelivery[],
): Promise<void> {
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
