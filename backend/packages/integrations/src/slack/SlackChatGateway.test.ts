import type { AttentionRequest, Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { boardReviewUrl } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { SlackChatGateway } from './SlackChatGateway.js'

const review: ReviewRequest = {
  id: 'rev-1',
  pullRequest: {
    provider: 'github',
    owner: 'kibertoad',
    repo: 'sainte-beuve',
    number: 7,
    url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
  },
  title: 'Add a health check',
  authorLogin: 'kibertoad',
  requiredSkills: ['typescript'],
  priority: 'normal',
  status: 'assigned',
  assignedReviewerIds: ['rvw-1'],
  createdAt: 0,
  updatedAt: 0,
  assignedAt: 0,
  dueAt: null,
}

const reminder: Reminder = {
  id: 'rem-1',
  reviewId: 'rev-1',
  kind: 'pending',
  channel: 'slack_dm',
  reviewerId: 'rvw-1',
  dueAt: 0,
  snoozedUntil: null,
  claimedAt: null,
  status: 'scheduled',
  sentAt: null,
  failureReason: null,
  createdAt: 0,
}

const ask: AttentionRequest = {
  id: 'att-1',
  pullRequest: review.pullRequest,
  title: 'Add a health check',
  requestedById: 'rvw-2',
  requestedByName: 'Igor',
  recipients: [{ reviewerId: 'rvw-1', displayName: 'Ada' }],
  chatDeliveries: [],
  requiredSkills: [],
  sameTeamOnly: false,
  team: null,
  neededCommitments: 1,
  commitments: [],
  note: null,
  status: 'open',
  createdAt: 0,
  updatedAt: 0,
  resolvedAt: null,
}

const notice = { request: ask, recipientId: 'rvw-1', matchedSkills: [], matchedDomains: [] }

function stubFetch(body: unknown, status = 200) {
  const calls: { url: string; payload: Record<string, unknown> }[] = []
  const impl: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { impl, calls }
}

describe('SlackChatGateway', () => {
  it('announces a review with a link and the skills it needs', async () => {
    const { impl, calls } = stubFetch({ ok: true, ts: '1700000000.000100' })
    const gateway = new SlackChatGateway({ botToken: 'xoxb-test', fetch: impl })

    const result = await gateway.announceReview(review, 'C123')

    expect(result.messageId).toBe('1700000000.000100')
    expect(calls[0]?.url).toBe('https://slack.com/api/chat.postMessage')
    expect(calls[0]?.payload.channel).toBe('C123')
    expect(calls[0]?.payload.text).toContain('kibertoad/sainte-beuve#7')
    expect(calls[0]?.payload.text).toContain('needs typescript')
  })

  it('links back to the board when the deployment knows its own URL', async () => {
    const { impl, calls } = stubFetch({ ok: true })
    const gateway = new SlackChatGateway({
      botToken: 'xoxb-test',
      appBaseUrl: 'https://sainte-beuve.example.com',
      fetch: impl,
    })

    await gateway.sendReminder(reminder, review, 'U123')

    expect(calls[0]?.payload.text).toContain(
      boardReviewUrl('https://sainte-beuve.example.com', 'rev-1'),
    )
  })

  it('DMs an attention ask to the user and answers with the DM conversation, not the user', async () => {
    const { impl, calls } = stubFetch({ ok: true, channel: 'D777', ts: '1700000000.000200' })
    const gateway = new SlackChatGateway({ botToken: 'xoxb-test', fetch: impl })

    const message = await gateway.sendAttentionAsk(notice, 'U123')

    expect(message).toStrictEqual({ conversationId: 'D777', messageId: '1700000000.000200' })
    expect(calls[0]?.url).toBe('https://slack.com/api/chat.postMessage')
    expect(calls[0]?.payload.channel).toBe('U123')
    expect(calls[0]?.payload.text).toContain('Igor asks you to review')
  })

  it('updates a delivered ask in place, by its conversation and timestamp', async () => {
    const { impl, calls } = stubFetch({ ok: true })
    const gateway = new SlackChatGateway({ botToken: 'xoxb-test', fetch: impl })

    await gateway.updateAttentionAsk(
      { ...notice, request: { ...ask, status: 'cancelled' } },
      { conversationId: 'D777', messageId: '1700000000.000200' },
    )

    expect(calls[0]?.url).toBe('https://slack.com/api/chat.update')
    expect(calls[0]?.payload).toMatchObject({ channel: 'D777', ts: '1700000000.000200' })
    expect(calls[0]?.payload.text).toContain('withdrew')
  })

  it('treats an ok:false 200 as a failure, carrying the slug an operator can act on', async () => {
    const { impl } = stubFetch({ ok: false, error: 'channel_not_found' })
    const gateway = new SlackChatGateway({ botToken: 'xoxb-test', fetch: impl })

    await expect(gateway.announceReview(review, 'C123')).rejects.toThrow('channel_not_found')
  })

  it('reports the status code when Slack answers with an HTTP error', async () => {
    const { impl } = stubFetch({}, 503)
    const gateway = new SlackChatGateway({ botToken: 'xoxb-test', fetch: impl })

    await expect(gateway.announceReview(review, 'C123')).rejects.toThrow('Slack answered 503')
  })
})
