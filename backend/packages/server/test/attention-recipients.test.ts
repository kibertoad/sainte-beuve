import type { AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryAttentionBus } from '../src/realtime/InMemoryAttentionBus.js'
import {
  addReviewer,
  buildHarness,
  environmentVcs,
  get,
  PR,
  post,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// An ask that names its reviewers: it reaches exactly those people, whatever
// the skill gate would have said, and the names are checked on the way in.

const ATTENTION = '/api/v1/attention'

function as(harness: TestHarness, username: string): TestHarness {
  return buildHarness({ ...harness.container, vcs: environmentVcs(viewerVcs(username)) })
}

async function inbox(harness: TestHarness): Promise<AttentionRequest[]> {
  const res = await harness.app.fetch(get(ATTENTION))
  expect(res.status).toBe(200)
  return ((await res.json()) as { requests: AttentionRequest[] }).requests
}

async function raise(harness: TestHarness, body: Record<string, unknown>): Promise<Response> {
  return await harness.app.fetch(
    post(ATTENTION, { pullRequest: PR, title: 'Add a health check', ...body }),
  )
}

describe('an ask that names its reviewers', () => {
  let asker: TestHarness
  let requester: Reviewer
  let named: Reviewer
  let gated: Reviewer

  beforeEach(async () => {
    asker = buildHarness(
      { vcs: environmentVcs(viewerVcs('kibertoad')) },
      { bus: new InMemoryAttentionBus() },
    )
    requester = await addReviewer(asker, { displayName: 'Igor', handles: { github: 'kibertoad' } })
    named = await addReviewer(asker, {
      displayName: 'Named',
      handles: { github: 'named' },
      skills: ['Frontend'],
    })
    gated = await addReviewer(asker, {
      displayName: 'Gated',
      handles: { github: 'gated' },
      skills: ['Backend'],
    })
  })

  it('reaches the people it names and nobody the skill gate would add', async () => {
    const res = await raise(asker, { recipientIds: [named.id], requiredSkills: ['Backend'] })
    expect(res.status).toBe(201)
    const request = (await res.json()) as AttentionRequest
    expect(request.recipients).toStrictEqual([{ reviewerId: named.id, displayName: 'Named' }])

    expect(await inbox(as(asker, 'named'))).toHaveLength(1)
    expect(await inbox(as(asker, 'gated'))).toHaveLength(0)
  })

  it('still lets somebody who was not named volunteer', async () => {
    const request = (await (
      await raise(asker, { recipientIds: [named.id] })
    ).json()) as AttentionRequest
    const res = await as(asker, 'gated').app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))
    expect(res.status).toBe(200)
    expect(((await res.json()) as AttentionRequest).status).toBe('resolved')
  })

  it('refuses a name that is not in the directory', async () => {
    expect((await raise(asker, { recipientIds: ['nobody'] })).status).toBe(400)
  })

  it('refuses the requester naming themselves', async () => {
    expect((await raise(asker, { recipientIds: [requester.id] })).status).toBe(400)
  })

  it('refuses somebody who has paused', async () => {
    await asker.container.repositories.reviewers.update(gated.id, { availability: 'paused' })
    expect((await raise(asker, { recipientIds: [gated.id] })).status).toBe(400)
  })

  it('refuses waiting for more people than it names', async () => {
    const res = await raise(asker, { recipientIds: [named.id], neededCommitments: 2 })
    expect(res.status).toBe(400)
  })

  it('counts a name given twice once', async () => {
    const res = await raise(asker, { recipientIds: [named.id, named.id, gated.id] })
    const request = (await res.json()) as AttentionRequest
    expect(request.recipients.map((entry) => entry.reviewerId)).toStrictEqual([named.id, gated.id])
  })
})
