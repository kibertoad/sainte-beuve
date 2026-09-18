import type { ReviewRequest } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { announcementChannel, resolveChat } from '../../integrations/resolve.js'

/**
 * Tell the team a review is waiting.
 *
 * Best-effort, and deliberately so: the review request is already committed by
 * the time this runs, and a Slack outage must not lose it or fail the webhook
 * that created it. The two ways this does nothing are both configuration rather
 * than faults, and they are logged at DEBUG because a deployment with no Slack
 * workspace is a supported deployment and would otherwise warn on every review.
 *
 * A failed POST is a WARNING, because that one is actionable: an archived
 * channel or a bot that was removed from it fails every time, and the message
 * carries Slack's own slug.
 */
export async function announceReview(
  container: AppContainer,
  review: ReviewRequest,
): Promise<void> {
  // This ORG's channel, which a named org does not have one of: `SLACK_CHANNEL_ID`
  // is a channel in the deployment's own workspace. See `announcementChannel`.
  const channelId = announcementChannel(container)
  const chat = await resolveChat(container)
  if (chat === null || channelId === null) {
    container.logger.debug(
      { reviewId: review.id, chat: chat !== null, channel: channelId !== null },
      'not announcing a review: chat is not fully configured',
    )
    return
  }
  try {
    await chat.gateway.announceReview(review, channelId)
  } catch (err) {
    container.logger.warn({ err, reviewId: review.id }, 'could not announce the review in chat')
  }
}
