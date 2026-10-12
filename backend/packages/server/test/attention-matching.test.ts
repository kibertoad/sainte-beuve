import type { AttentionRequest } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  PR,
  type TestHarness,
  addReviewer,
  buildHarness,
  environmentVcs,
  get,
  post,
  recordingChat,
  viewerVcs,
} from './helpers.js'

// Who a broadcast ask reaches is decided purely in @sainte-beuve/reviewers.
// This suite covers what the app adds: the skills and domains an ask is
// matched against come from the same place the recommendations rank against.

const ATTENTION = '/api/v1/attention'

function harnessFor(
  username: string,
  base?: TestHarness,
  chat?: ReturnType<typeof recordingChat>,
): TestHarness {
  return buildHarness({
    ...base?.container,
    ...(chat === undefined ? {} : { chat }),
    vcs: environmentVcs(viewerVcs(username)),
  })
}

async function registerProject(h: TestHarness, skills: string[], domains: string[]) {
  const res = await h.app.fetch(
    post('/api/v1/projects', {
      provider: 'github',
      owner: PR.owner,
      repo: PR.repo,
      skills,
      domains,
    }),
  )
  expect(res.status).toBe(201)
}

async function raise(
  h: TestHarness,
  body: Record<string, unknown> = {},
): Promise<AttentionRequest> {
  const res = await h.app.fetch(post(ATTENTION, { pullRequest: PR, title: 'Bill it', ...body }))
  expect(res.status).toBe(201)
  return (await res.json()) as AttentionRequest
}

async function inboxSize(asker: TestHarness, username: string): Promise<number> {
  const res = await harnessFor(username, asker).app.fetch(get(ATTENTION))
  expect(res.status).toBe(200)
  return ((await res.json()) as { requests: AttentionRequest[] }).requests.length
}

describe('what a broadcast ask is matched against', () => {
  it("takes the repository's skills and domains when nobody picked a skill", async () => {
    const asker = harnessFor('kibertoad')
    await registerProject(asker, ['Backend'], ['billing'])
    await addReviewer(asker, {
      displayName: 'Biller',
      handles: { github: 'biller' },
      domains: ['billing'],
    })
    await addReviewer(asker, {
      displayName: 'Stranger',
      handles: { github: 'stranger' },
      skills: ['Mobile'],
    })

    const request = await raise(asker)

    expect(request).toMatchObject({ requiredSkills: ['Backend'], domains: ['billing'] })
    expect(await inboxSize(asker, 'biller')).toBe(1)
    expect(await inboxSize(asker, 'stranger')).toBe(0)
  })

  it('reaches somebody holding half of two picked skills, as the board would', async () => {
    const asker = harnessFor('kibertoad')
    await addReviewer(asker, {
      displayName: 'Backender',
      handles: { github: 'backender' },
      skills: ['Backend'],
    })
    await addReviewer(asker, {
      displayName: 'Designer',
      handles: { github: 'designer' },
      skills: ['Design'],
    })

    await raise(asker, { requiredSkills: ['Backend', 'Frontend'] })

    expect(await inboxSize(asker, 'backender')).toBe(1)
    expect(await inboxSize(asker, 'designer')).toBe(0)
  })

  it('asks everybody available on a repository that wants nothing in particular', async () => {
    const asker = harnessFor('kibertoad')
    await addReviewer(asker, {
      displayName: 'Anyone',
      handles: { github: 'anyone' },
      skills: ['Mobile'],
    })

    const request = await raise(asker)

    expect(request).toMatchObject({ requiredSkills: [], domains: [] })
    expect(await inboxSize(asker, 'anyone')).toBe(1)
  })

  it('keeps what was matched when the repository is edited afterwards', async () => {
    const asker = harnessFor('kibertoad')
    await registerProject(asker, ['Backend'], [])
    await addReviewer(asker, {
      displayName: 'Backender',
      handles: { github: 'backender' },
      skills: ['Backend'],
    })
    await raise(asker)

    const [project] = await asker.container.repositories.projects.list()
    await asker.container.repositories.projects.update(project?.id ?? '', { skills: ['Mobile'] })

    expect(await inboxSize(asker, 'backender')).toBe(1)
  })

  it('moves a named ask on to the best match for what it stored, and DMs why they fit', async () => {
    const chat = recordingChat()
    const asker = harnessFor('kibertoad', undefined, chat)
    await registerProject(asker, [], ['billing'])
    const named = await addReviewer(asker, { displayName: 'Named', handles: { github: 'named' } })
    // Alphabetically first, so only the stored mix keeps them below Zed.
    await addReviewer(asker, {
      displayName: 'Amy',
      handles: { github: 'amy' },
      domains: ['mobile'],
      slackUserId: 'U-amy',
    })
    const zed = await addReviewer(asker, {
      displayName: 'Zed',
      handles: { github: 'zed' },
      domains: ['billing'],
      slackUserId: 'U-zed',
    })
    const request = await raise(asker, { recipientIds: [named.id], keepAsking: true })

    const [project] = await asker.container.repositories.projects.list()
    await asker.container.repositories.projects.update(project?.id ?? '', { domains: ['mobile'] })
    const res = await harnessFor('named', asker, chat).app.fetch(
      post(`${ATTENTION}/${request.id}/decline`, {}),
    )
    expect(res.status).toBe(200)

    const declined = (await res.json()) as AttentionRequest
    expect(declined.recipients.map((entry) => entry.reviewerId)).toStrictEqual([named.id, zed.id])
    expect(chat.asks.map((ask) => ask.notice)).toMatchObject([
      { recipientId: zed.id, matchedSkills: [], matchedDomains: ['billing'] },
    ])
  })
})
