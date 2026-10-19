import type { AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import type { ChatGateway } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addReviewer,
  buildHarness,
  del,
  environmentVcs,
  noAttentionDms,
  PR,
  post,
  recordingChat,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// A named ask goes out as a Slack DM to each recipient who has a Slack id, and
// the DMs follow the ask: the committer's says so, and every one closes when
// the ask resolves or is withdrawn. Slack failing costs the DM, never the ask.

const ATTENTION = '/api/v1/attention'

function as(harness: TestHarness, username: string): TestHarness {
  return buildHarness({ ...harness.container, vcs: environmentVcs(viewerVcs(username)) })
}

async function raise(
  harness: TestHarness,
  body: Record<string, unknown>,
): Promise<AttentionRequest> {
  const res = await harness.app.fetch(
    post(ATTENTION, { pullRequest: PR, title: 'Add a health check', ...body }),
  )
  expect(res.status).toBe(201)
  return (await res.json()) as AttentionRequest
}

async function commit(harness: TestHarness, attentionId: string): Promise<AttentionRequest> {
  const res = await harness.app.fetch(post(`${ATTENTION}/${attentionId}/commit`, {}))
  expect(res.status).toBe(200)
  return (await res.json()) as AttentionRequest
}

describe('the Slack DMs of a named ask', () => {
  let chat: ReturnType<typeof recordingChat>
  let asker: TestHarness
  let ada: Reviewer
  let bo: Reviewer
  let quiet: Reviewer

  beforeEach(async () => {
    chat = recordingChat()
    asker = buildHarness({ chat, vcs: environmentVcs(viewerVcs('kibertoad')) })
    await addReviewer(asker, { displayName: 'Igor', handles: { github: 'kibertoad' } })
    ada = await addReviewer(asker, {
      displayName: 'Ada',
      handles: { github: 'ada' },
      skills: ['Backend'],
      slackUserId: 'U-ada',
    })
    bo = await addReviewer(asker, {
      displayName: 'Bo',
      handles: { github: 'bo' },
      slackUserId: 'U-bo',
    })
    quiet = await addReviewer(asker, { displayName: 'Quiet', handles: { github: 'quiet' } })
  })

  it('DMs each named recipient with a Slack id, and stores where each landed', async () => {
    const request = await raise(asker, {
      recipientIds: [ada.id, bo.id, quiet.id],
      requiredSkills: ['Backend'],
    })

    expect(chat.asks.map((ask) => ask.target)).toStrictEqual(['U-ada', 'U-bo'])
    expect(chat.asks[0]?.notice).toMatchObject({ recipientId: ada.id, matchedSkills: ['Backend'] })
    expect(chat.asks[1]?.notice.matchedSkills).toStrictEqual([])
    expect(request.chatDeliveries).toStrictEqual([
      { reviewerId: ada.id, conversationId: 'D-U-ada', messageId: 'ts-1' },
      { reviewerId: bo.id, conversationId: 'D-U-bo', messageId: 'ts-2' },
    ])
  })

  it('DMs nobody for an ask nobody was named on', async () => {
    await raise(asker, { requiredSkills: ['Backend'] })
    expect(chat.asks).toStrictEqual([])
  })

  it('updates only the committer while the ask still waits, and everybody once it resolves', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id], neededCommitments: 2 })

    await commit(as(asker, 'ada'), request.id)
    expect(chat.askUpdates.map((update) => update.target)).toStrictEqual(['D-U-ada'])

    await commit(as(asker, 'bo'), request.id)
    expect(chat.askUpdates.slice(1).map((update) => update.target)).toStrictEqual([
      'D-U-ada',
      'D-U-bo',
    ])
    expect(chat.askUpdates.at(-1)?.notice.request.status).toBe('resolved')
  })

  it('closes every DM when the requester withdraws the ask', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id] })
    const res = await asker.app.fetch(del(`${ATTENTION}/${request.id}`))
    expect(res.status).toBe(200)
    expect(chat.askUpdates.map((update) => update.notice.request.status)).toStrictEqual([
      'cancelled',
      'cancelled',
    ])
  })

  it('raises the ask when Slack refuses the DM, with no delivery recorded', async () => {
    const refusing: ChatGateway = {
      announceReview: async () => ({ messageId: 'm' }),
      sendReminder: async () => {},
      ...noAttentionDms(),
    }
    const request = await raise(buildHarness({ ...asker.container, chat: refusing }), {
      recipientIds: [ada.id],
    })
    expect(request.status).toBe('open')
    expect(request.chatDeliveries).toStrictEqual([])
  })

  it('takes a commit pressed while the other DMs are still in flight, and closes that DM', async () => {
    let committed: AttentionRequest | null = null
    const racing: ChatGateway = {
      ...chat,
      sendAttentionAsk: async (notice, target) => {
        const message = await chat.sendAttentionAsk(notice, target)
        if (target === 'U-ada') committed = await commit(as(asker, 'ada'), notice.request.id)
        return message
      },
    }
    const request = await raise(buildHarness({ ...asker.container, chat: racing }), {
      recipientIds: [ada.id, bo.id],
      neededCommitments: 2,
    })

    expect(committed).not.toBeNull()
    expect(request.commitments.map((entry) => entry.reviewerId)).toStrictEqual([ada.id])
    expect(request.chatDeliveries.map((delivery) => delivery.reviewerId)).toStrictEqual([
      ada.id,
      bo.id,
    ])
    expect(chat.askUpdates.map((update) => update.target)).toStrictEqual(['D-U-ada'])
  })

  it('raises the ask when recording where its DMs landed fails', async () => {
    const { repositories } = asker.container
    const brokenChanges = buildHarness({
      ...asker.container,
      repositories: {
        ...repositories,
        attention: {
          list: (filter) => repositories.attention.list(filter),
          getById: (id) => repositories.attention.getById(id),
          create: (request) => repositories.attention.create(request),
          createOrGetOwn: (request) => repositories.attention.createOrGetOwn(request),
          change: async () => {
            throw new Error('the attention store is down')
          },
        },
      },
    })
    const request = await raise(brokenChanges, { recipientIds: [ada.id] })
    expect(request.status).toBe('open')
    expect(chat.asks.map((ask) => ask.target)).toStrictEqual(['U-ada'])
    expect(request.chatDeliveries).toStrictEqual([])
  })

  it('raises the ask with no DMs when a read on the way to Slack fails', async () => {
    const { repositories } = asker.container
    const brokenTokens = buildHarness(
      {
        chat,
        vcs: environmentVcs(viewerVcs('kibertoad')),
        repositories: {
          ...repositories,
          integrationTokens: {
            ...repositories.integrationTokens,
            get: async (key) => {
              if (key === 'slack-bot-token') throw new Error('the token store is down')
              return repositories.integrationTokens.get(key)
            },
          },
        },
      },
      { encryptionKey: btoa('0123456789abcdef0123456789abcdef') },
    )
    const request = await raise(brokenTokens, { recipientIds: [ada.id] })
    expect(request.chatDeliveries).toStrictEqual([])
    expect(chat.asks).toStrictEqual([])
  })

  it('raises the ask as before when the org has no Slack', async () => {
    const request = await raise(buildHarness({ ...asker.container, chat: null }), {
      recipientIds: [ada.id],
    })
    expect(request.chatDeliveries).toStrictEqual([])
  })
})
