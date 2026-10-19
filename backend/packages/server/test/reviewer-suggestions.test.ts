import type { AttentionRequest, Reviewer, ReviewerSuggestions } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
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

// Suggesting reviewers for your own pull request from My PRs: a ranked list
// with the top two ticked, and asking the people picked through a named
// attention ask, so they are DMed and commit as any named ask lets them.

const SUGGEST = '/api/v1/my-pull-requests/reviewer-suggestions'
const ASK = '/api/v1/my-pull-requests/reviewer-asks'

function as(harness: TestHarness, username: string): TestHarness {
  return buildHarness({ ...harness.container, vcs: environmentVcs(viewerVcs(username)) })
}

async function suggest(harness: TestHarness, body: Record<string, unknown> = {}) {
  const res = await harness.app.fetch(post(SUGGEST, { pullRequest: PR, ...body }))
  expect(res.status).toBe(200)
  return (await res.json()) as ReviewerSuggestions
}

function askFor(harness: TestHarness, reviewerIds: string[]): Promise<Response> {
  return harness.app.fetch(post(ASK, { pullRequest: PR, title: 'Add a health check', reviewerIds }))
}

async function asked(harness: TestHarness, reviewerIds: string[]): Promise<AttentionRequest> {
  const res = await askFor(harness, reviewerIds)
  expect(res.status).toBe(200)
  return (await res.json()) as AttentionRequest
}

describe('suggesting reviewers for my pull request', () => {
  let chat: ReturnType<typeof recordingChat>
  let author: TestHarness
  let ada: Reviewer
  let bo: Reviewer
  let cy: Reviewer

  beforeEach(async () => {
    chat = recordingChat()
    author = buildHarness({ chat, vcs: environmentVcs(viewerVcs('kibertoad')) })
    await addReviewer(author, { displayName: 'Igor', handles: { github: 'kibertoad' } })
    ada = await addReviewer(author, {
      displayName: 'Ada',
      handles: { github: 'ada' },
      slackUserId: 'U-ada',
    })
    bo = await addReviewer(author, {
      displayName: 'Bo',
      handles: { github: 'bo' },
      slackUserId: 'U-bo',
    })
    cy = await addReviewer(author, { displayName: 'Cy', handles: { github: 'cy' } })
    await addReviewer(author, { displayName: 'Renovate', handles: { github: 'renovate[bot]' } })
  })

  it('ranks the directory, ticks the top two, and leaves out the author and bots', async () => {
    const suggestions = await suggest(author)

    expect(suggestions.recommendations.map((entry) => entry.displayName)).toStrictEqual([
      'Ada',
      'Bo',
      'Cy',
    ])
    expect(suggestions.preselectedIds).toStrictEqual([ada.id, bo.id])
    expect(suggestions.others).toStrictEqual([])
    expect(suggestions.involved).toStrictEqual([])
  })

  it('asks the people picked by name and DMs them to commit', async () => {
    const request = await asked(author, [ada.id, bo.id])

    expect(request.recipients.map((entry) => entry.reviewerId)).toStrictEqual([ada.id, bo.id])
    expect(request.neededCommitments).toBe(2)
    expect(chat.asks.map((entry) => entry.target)).toStrictEqual(['U-ada', 'U-bo'])

    const inbox = await as(author, 'ada').app.fetch(get('/api/v1/attention'))
    expect(((await inbox.json()) as { requests: AttentionRequest[] }).requests).toHaveLength(1)
  })

  it('asks nobody twice, and adds a new name to the same ask', async () => {
    const first = await asked(author, [ada.id])
    const again = await asked(author, [ada.id])
    const more = await asked(author, [ada.id, cy.id])

    expect(again.id).toBe(first.id)
    expect(more.id).toBe(first.id)
    expect(more.recipients.map((entry) => entry.reviewerId)).toStrictEqual([ada.id, cy.id])
    expect(chat.asks.map((entry) => entry.target)).toStrictEqual(['U-ada'])
  })

  it('shows who is already on it rather than offering them again', async () => {
    const request = await asked(author, [ada.id, bo.id])
    const commit = await as(author, 'ada').app.fetch(
      post(`/api/v1/attention/${request.id}/commit`, {}),
    )
    expect(commit.status).toBe(200)

    const suggestions = await suggest(author, { requestedReviewerLogins: ['cy'] })

    expect(suggestions.recommendations).toStrictEqual([])
    expect(suggestions.preselectedIds).toStrictEqual([])
    expect(suggestions.involved.map((entry) => [entry.displayName, entry.state])).toStrictEqual([
      ['Ada', 'committed'],
      ['Bo', 'asked'],
      ['Cy', 'requested'],
    ])
  })

  it('refuses to ask somebody who already committed, with nothing else to ask', async () => {
    await as(author, 'ada').app.fetch(
      post('/api/v1/commitments', { pullRequest: PR, title: 'Add a health check' }),
    )

    const res = await askFor(author, [ada.id])

    expect(res.status).toBe(409)
    expect(chat.asks).toStrictEqual([])
  })

  it("refuses somebody else's pull request", async () => {
    const bystander = buildHarness({
      ...author.container,
      vcs: environmentVcs(viewerVcs('bo', [], { [PR.number]: { authorLogin: 'kibertoad' } })),
    })

    const res = await bystander.app.fetch(post(SUGGEST, { pullRequest: PR }))
    const ask = await askFor(bystander, [ada.id])

    expect(res.status).toBe(403)
    expect(ask.status).toBe(403)
  })
})
