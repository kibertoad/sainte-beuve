import type { AttentionEvent, AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { reaches } from '../src/modules/attention/AttentionService.js'
import {
  addReviewer,
  buildHarness,
  environmentVcs,
  get,
  PR,
  post,
  recordingChat,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// Saying no to an ask: it leaves the decliner's inbox, the requester sees who
// passed, and a named ask the declines leave short moves on to the next best
// match, by itself when the requester chose that and on one click otherwise.

const ATTENTION = '/api/v1/attention'

function as(harness: TestHarness, username: string): TestHarness {
  return buildHarness({ ...harness.container, vcs: environmentVcs(viewerVcs(username)) })
}

async function inbox(harness: TestHarness): Promise<AttentionRequest[]> {
  const res = await harness.app.fetch(get(ATTENTION))
  expect(res.status).toBe(200)
  return ((await res.json()) as { requests: AttentionRequest[] }).requests
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

async function decline(
  harness: TestHarness,
  attentionId: string,
  reason?: string,
): Promise<Response> {
  return await harness.app.fetch(post(`${ATTENTION}/${attentionId}/decline`, { reason }))
}

async function askMore(
  harness: TestHarness,
  attentionId: string,
  recipientIds?: string[],
): Promise<Response> {
  return await harness.app.fetch(post(`${ATTENTION}/${attentionId}/recipients`, { recipientIds }))
}

async function body(res: Response): Promise<AttentionRequest> {
  return (await res.json()) as AttentionRequest
}

describe('declining an ask', () => {
  let chat: ReturnType<typeof recordingChat>
  let asker: TestHarness
  let ada: Reviewer
  let bo: Reviewer
  let cy: Reviewer

  beforeEach(async () => {
    chat = recordingChat()
    asker = buildHarness({ chat, vcs: environmentVcs(viewerVcs('kibertoad')) })
    await addReviewer(asker, {
      displayName: 'Igor',
      handles: { github: 'kibertoad' },
      slackUserId: 'U-igor',
    })
    ada = await addReviewer(asker, {
      displayName: 'Ada',
      handles: { github: 'ada' },
      skills: ['Backend'],
      slackUserId: 'U-ada',
    })
    bo = await addReviewer(asker, { displayName: 'Bo', handles: { github: 'bo' } })
    cy = await addReviewer(asker, {
      displayName: 'Cy',
      handles: { github: 'cy' },
      skills: ['Backend'],
      slackUserId: 'U-cy',
    })
  })

  it('takes the ask off the decliner and shows the requester who passed, and why', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id] })

    const res = await decline(as(asker, 'ada'), request.id, 'On leave this week')
    expect(res.status).toBe(200)
    const declined = await body(res)
    expect(declined.status).toBe('open')
    expect(declined.declines).toMatchObject([
      { reviewerId: ada.id, displayName: 'Ada', reason: 'On leave this week' },
    ])

    expect(await inbox(as(asker, 'ada'))).toStrictEqual([])
    expect((await inbox(as(asker, 'bo'))).map((entry) => entry.id)).toStrictEqual([request.id])
    expect((await inbox(asker)).at(0)?.declines.at(0)?.reviewerId).toBe(ada.id)
    // The decliner's DM is re-rendered to say they passed.
    expect(chat.askUpdates.map((update) => update.target)).toStrictEqual(['D-U-ada'])
  })

  it('is refused to the requester and to anybody the ask never reached', async () => {
    const request = await raise(asker, { recipientIds: [ada.id] })
    expect((await decline(asker, request.id)).status).toBe(403)
    expect((await decline(as(asker, 'bo'), request.id)).status).toBe(403)
  })

  it('is refused to somebody who already committed', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id], neededCommitments: 2 })
    const committer = as(asker, 'ada')
    expect((await committer.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))).status).toBe(
      200,
    )
    expect((await decline(committer, request.id)).status).toBe(409)
  })

  it('clears the decline of somebody who then commits after all', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id] })
    const decliner = as(asker, 'ada')
    await decline(decliner, request.id)
    const res = await decliner.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))
    const committed = await body(res)
    expect(committed.status).toBe('resolved')
    expect(committed.declines).toStrictEqual([])
  })

  it('asks the next best match by itself when the requester chose to keep asking', async () => {
    const request = await raise(asker, {
      recipientIds: [ada.id],
      requiredSkills: ['Backend'],
      keepAsking: true,
    })

    const declined = await body(await decline(as(asker, 'ada'), request.id))

    // Cy holds the wanted skill and Bo does not, so Cy is the next best match.
    expect(declined.recipients.map((entry) => entry.reviewerId)).toStrictEqual([ada.id, cy.id])
    expect(chat.asks.map((ask) => ask.target)).toStrictEqual(['U-ada', 'U-cy'])
    expect(declined.chatDeliveries.map((delivery) => delivery.reviewerId)).toStrictEqual([
      ada.id,
      cy.id,
    ])
    expect((await inbox(as(asker, 'cy'))).map((entry) => entry.id)).toStrictEqual([request.id])
  })

  it('never moves on to the author the host listed, though the board has no row', async () => {
    const request = await raise(asker, {
      recipientIds: [ada.id],
      requiredSkills: ['Backend'],
      keepAsking: true,
      people: { authorLogin: 'cy', requestedReviewerLogins: [] },
    })

    const declined = await body(await decline(as(asker, 'ada'), request.id))

    expect(declined.recipients.map((entry) => entry.reviewerId)).not.toContain(cy.id)
    expect(chat.asks.map((ask) => ask.target)).toStrictEqual(['U-ada'])
  })

  it('refuses to name the author the host listed', async () => {
    const res = await asker.app.fetch(
      post(ATTENTION, {
        pullRequest: PR,
        title: 'Add a health check',
        recipientIds: [cy.id],
        people: { authorLogin: 'cy', requestedReviewerLogins: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('lets somebody named and paused since say no', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id] })
    await asker.container.repositories.reviewers.update(ada.id, { availability: 'paused' })
    expect((await decline(as(asker, 'ada'), request.id)).status).toBe(200)
  })

  it('stores a blank reason as no reason', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id] })
    const declined = await body(await decline(as(asker, 'ada'), request.id, '   '))
    expect(declined.declines.at(0)?.reason).toBeNull()
  })

  it('leaves a short ask to the requester when they did not choose to keep asking', async () => {
    const request = await raise(asker, { recipientIds: [ada.id], requiredSkills: ['Backend'] })
    const declined = await body(await decline(as(asker, 'ada'), request.id))
    expect(declined.recipients.map((entry) => entry.reviewerId)).toStrictEqual([ada.id])
    expect(await inbox(as(asker, 'cy'))).toStrictEqual([])
    // The requester is told once, by the decline that left the ask short.
    expect(chat.shortNotices.map((notice) => notice.target)).toStrictEqual(['U-igor'])
    await decline(as(asker, 'ada'), request.id, 'Still away')
    expect(chat.shortNotices).toHaveLength(1)
  })

  it('does not tell the requester while the ask can still fill or has asked on', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id] })
    await decline(as(asker, 'ada'), request.id)
    const kept = await raise(asker, {
      recipientIds: [ada.id],
      requiredSkills: ['Backend'],
      keepAsking: true,
    })
    await decline(as(asker, 'ada'), kept.id)
    expect(chat.shortNotices).toStrictEqual([])
  })
})

describe('asking more people on an ask', () => {
  let asker: TestHarness
  let ada: Reviewer
  let bo: Reviewer
  let cy: Reviewer

  beforeEach(async () => {
    asker = buildHarness({ chat: recordingChat(), vcs: environmentVcs(viewerVcs('kibertoad')) })
    await addReviewer(asker, { displayName: 'Igor', handles: { github: 'kibertoad' } })
    ada = await addReviewer(asker, { displayName: 'Ada', handles: { github: 'ada' } })
    bo = await addReviewer(asker, { displayName: 'Bo', handles: { github: 'bo' } })
    cy = await addReviewer(asker, {
      displayName: 'Cy',
      handles: { github: 'cy' },
      skills: ['Backend'],
    })
  })

  it('asks the next best match when the requester names nobody', async () => {
    const request = await raise(asker, { recipientIds: [ada.id], requiredSkills: ['Backend'] })
    await decline(as(asker, 'ada'), request.id)

    const res = await askMore(asker, request.id)
    expect(res.status).toBe(200)
    expect((await body(res)).recipients.map((entry) => entry.reviewerId)).toStrictEqual([
      ada.id,
      cy.id,
    ])
  })

  it('asks the people the requester names, passing over anybody already asked', async () => {
    const request = await raise(asker, { recipientIds: [ada.id] })
    const res = await askMore(asker, request.id, [ada.id, bo.id])
    expect(res.status).toBe(200)
    expect((await body(res)).recipients.map((entry) => entry.reviewerId)).toStrictEqual([
      ada.id,
      bo.id,
    ])
  })

  it('answers a repeated click as the ask stands', async () => {
    const request = await raise(asker, { recipientIds: [ada.id] })
    await askMore(asker, request.id, [bo.id])
    const res = await askMore(asker, request.id, [bo.id])
    expect(res.status).toBe(200)
    expect((await body(res)).recipients.map((entry) => entry.reviewerId)).toStrictEqual([
      ada.id,
      bo.id,
    ])
  })

  it('is refused to anybody but the requester', async () => {
    const request = await raise(asker, { recipientIds: [ada.id] })
    expect((await askMore(as(asker, 'ada'), request.id, [bo.id])).status).toBe(403)
  })

  it('is refused on an ask sent by skill, which already reaches everybody who matches', async () => {
    const request = await raise(asker, { requiredSkills: ['Backend'] })
    expect((await askMore(asker, request.id, [bo.id])).status).toBe(400)
  })

  it('says so when nobody is left to ask', async () => {
    const request = await raise(asker, { recipientIds: [ada.id, bo.id, cy.id] })
    expect((await askMore(asker, request.id)).status).toBe(409)
  })
})

describe('the live event of a decline', () => {
  it('reaches the decliner, whose other pages have to drop the ask', () => {
    const decliner = { id: 'r-ada', availability: 'available' } as Reviewer
    const request = {
      requestedById: 'r-igor',
      recipients: [{ reviewerId: 'r-ada', displayName: 'Ada' }],
      commitments: [],
      declines: [{ reviewerId: 'r-ada', displayName: 'Ada', reason: null, declinedAt: 1 }],
    } as unknown as AttentionRequest
    const event = (kind: AttentionEvent['kind']): AttentionEvent => ({ kind, request })
    expect(reaches(event('declined'), decliner)).toBe(true)
    expect(reaches(event('committed'), decliner)).toBe(false)
  })
})
