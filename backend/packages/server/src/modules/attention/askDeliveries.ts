import type { AttentionDelivery, AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { recipientShortfall } from '@sainte-beuve/contracts'
import { deliveriesChange, hasDeclined, matchTargetFor, matchesOf } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveChat } from '../../integrations/resolve.js'
import { changeAsk } from './changeAsk.js'

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
 * DM people an ask that is already stored names, whether it was just raised or
 * just asked them, record where the messages landed next to the ones already
 * sent, and answer with the ask as it then stands.
 *
 * The row comes first so a button never points at an ask the store does not
 * hold yet. A commit or a decline that lands while the DMs are in flight is not
 * lost either: the store reruns whichever change comes second on the row the
 * other left, so either the answer refreshes the recorded DMs or this does.
 */
export async function sendAskDms(
  container: AppContainer,
  request: AttentionRequest,
  recipients: readonly Reviewer[],
): Promise<AttentionRequest> {
  const chatDeliveries = await deliverAsk(container, request, recipients)
  if (chatDeliveries.length === 0) return request
  let recorded: AttentionRequest
  try {
    const changed = await changeAsk(container, request.id, (stored) =>
      deliveriesChange(stored, chatDeliveries),
    )
    recorded = changed.request
  } catch (err) {
    container.logger.warn({ err, attentionId: request.id }, 'could not record the DMs of an ask')
    return request
  }
  await refreshDeliveries(container, recorded, chatDeliveries.filter(isStale(recorded)))
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
 * or was withdrawn, or only `reviewerId`'s when they committed or declined and
 * it is still open, since nobody else's message has anything new to say.
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

/**
 * Whether a DM no longer says what the ask says: it closed, or this recipient
 * committed or declined.
 */
function isStale(request: AttentionRequest): (delivery: AttentionDelivery) => boolean {
  return (delivery) =>
    request.status !== 'open' ||
    request.commitments.some((entry) => entry.reviewerId === delivery.reviewerId) ||
    hasDeclined(request, delivery.reviewerId)
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

/**
 * DM the requester that their named ask can no longer fill from the people it
 * names, when the decline that answered `before` made it shorter and nobody
 * was asked on. Only the decline that moves the shortfall tells them, so each
 * person they lose is one message and a repeated decline is none.
 */
export async function tellRequesterShort(
  container: AppContainer,
  before: AttentionRequest,
  after: AttentionRequest,
): Promise<void> {
  if (after.status !== 'open' || recipientShortfall(after) <= recipientShortfall(before)) return
  const reached = await quietly(container, after, async () => {
    const [chat, requester] = await Promise.all([
      resolveChat(container),
      container.repositories.reviewers.getById(after.requestedById),
    ])
    const target = requester?.slackUserId ?? null
    return chat === null || target === null ? null : { chat, target }
  })
  if (reached === null) return
  try {
    await reached.chat.gateway.sendAttentionShort(after, reached.target)
  } catch (err) {
    container.logger.warn(
      { err, attentionId: after.id },
      'could not DM the requester of a short ask',
    )
  }
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
