import type { AttentionRequest } from '@sainte-beuve/contracts'
import type { AttentionAskNotice, ChatGateway, ReviewDeclinedNotice } from '@sainte-beuve/kernel'

/** The attention-ask half of the chat port, for a fake that is never asked to DM one. */
export function noAttentionDms(): Pick<
  ChatGateway,
  'sendAttentionAsk' | 'updateAttentionAsk' | 'sendAttentionShort' | 'sendReviewDeclined'
> {
  return {
    sendAttentionAsk: () => Promise.reject(new Error('sendAttentionAsk is not stubbed')),
    updateAttentionAsk: () => Promise.reject(new Error('updateAttentionAsk is not stubbed')),
    sendAttentionShort: () => Promise.reject(new Error('sendAttentionShort is not stubbed')),
    sendReviewDeclined: () => Promise.reject(new Error('sendReviewDeclined is not stubbed')),
  }
}

/** One attention-ask DM a recording chat gateway was asked to send or update. */
interface RecordedAsk {
  target: string
  notice: AttentionAskNotice
}

/** A chat gateway that records what it posted where. */
export function recordingChat(): ChatGateway & {
  posted: { target: string; kind: string }[]
  asks: RecordedAsk[]
  askUpdates: RecordedAsk[]
  shortNotices: { target: string; request: AttentionRequest }[]
  declinedNotices: { target: string; notice: ReviewDeclinedNotice }[]
} {
  const posted: { target: string; kind: string }[] = []
  const asks: RecordedAsk[] = []
  const askUpdates: RecordedAsk[] = []
  const shortNotices: { target: string; request: AttentionRequest }[] = []
  const declinedNotices: { target: string; notice: ReviewDeclinedNotice }[] = []
  return {
    declinedNotices,
    posted,
    asks,
    askUpdates,
    shortNotices,
    announceReview: async (_review, channelId) => {
      posted.push({ target: channelId, kind: 'announcement' })
      return { messageId: 'ts-1' }
    },
    sendReminder: async (reminder, _review, target) => {
      posted.push({ target, kind: reminder.kind })
    },
    // A DM lands in a conversation of its own, named here after the user.
    sendAttentionAsk: async (notice, target) => {
      asks.push({ target, notice })
      return { conversationId: `D-${target}`, messageId: `ts-${asks.length}` }
    },
    updateAttentionAsk: async (notice, message) => {
      askUpdates.push({ target: message.conversationId, notice })
    },
    sendAttentionShort: async (request, target) => {
      shortNotices.push({ target, request })
    },
    sendReviewDeclined: async (notice, target) => {
      declinedNotices.push({ target, notice })
    },
  }
}
