import type { CreateReviewerInput, CreateReviewRequestInput } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { type TestHarness, buildHarness } from './helpers.js'

const PR: CreateReviewRequestInput['pullRequest'] = {
  provider: 'github',
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 7,
  url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function addReviewer(harness: TestHarness, reviewer: CreateReviewerInput) {
  const res = await harness.app.fetch(post('/api/v1/reviewers', reviewer))
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; displayName: string }
}

async function openReview(harness: TestHarness, overrides: Partial<CreateReviewRequestInput> = {}) {
  const res = await harness.app.fetch(
    post('/api/v1/reviews', {
      pullRequest: PR,
      title: 'Add a health check',
      authorLogin: 'author',
      ...overrides,
    }),
  )
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; status: string; assignedReviewerIds: string[] }
}

describe('review board API', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = buildHarness()
  })

  it('reports which capabilities the deployment wired', async () => {
    const res = await harness.app.fetch(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({
      status: 'ok',
      capabilities: { chat: false, vcs: false, aiReview: false },
    })
  })

  it('opens a review request and lists it', async () => {
    const review = await openReview(harness)
    expect(review.status).toBe('open')

    const listed = await harness.app.fetch(new Request('http://localhost/api/v1/reviews'))
    const body = (await listed.json()) as { reviews: { id: string }[] }
    expect(body.reviews.map((r) => r.id)).toStrictEqual([review.id])
  })

  it('refuses to track the same pull request twice', async () => {
    await openReview(harness)
    const res = await harness.app.fetch(
      post('/api/v1/reviews', { pullRequest: PR, title: 'Again', authorLogin: 'author' }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'conflict' } })
  })

  it('rejects a payload the contract does not accept', async () => {
    const res = await harness.app.fetch(post('/api/v1/reviews', { title: 'no pull request' }))
    expect(res.status).toBe(400)
  })

  it('assigns a reviewer with the required skill and never the author', async () => {
    const author = await addReviewer(harness, {
      displayName: 'Author',
      githubLogin: 'author',
      skills: ['typescript'],
    })
    const peer = await addReviewer(harness, {
      displayName: 'Peer',
      githubLogin: 'peer',
      skills: ['typescript'],
    })
    const review = await openReview(harness, { requiredSkills: ['typescript'] })

    const res = await harness.app.fetch(post(`/api/v1/reviews/${review.id}/assign`, { count: 1 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      assigned: { reviewerId: string }[]
      review: { status: string }
      shortfallReason: string | null
    }
    expect(body.assigned.map((a) => a.reviewerId)).toStrictEqual([peer.id])
    expect(body.assigned.map((a) => a.reviewerId)).not.toContain(author.id)
    expect(body.review.status).toBe('assigned')
    expect(body.shortfallReason).toBeNull()
  })

  it('says why it could not fill the request instead of assigning the wrong person', async () => {
    await addReviewer(harness, { displayName: 'Gopher', githubLogin: 'gopher', skills: ['go'] })
    const review = await openReview(harness, { requiredSkills: ['rust'] })

    const res = await harness.app.fetch(post(`/api/v1/reviews/${review.id}/assign`, { count: 1 }))
    const body = (await res.json()) as { assigned: unknown[]; shortfallReason: string }
    expect(body.assigned).toStrictEqual([])
    expect(body.shortfallReason).toBe('no_candidates')
  })

  it('answers 404 for a review that does not exist', async () => {
    const res = await harness.app.fetch(new Request('http://localhost/api/v1/reviews/nope'))
    expect(res.status).toBe(404)
  })

  it('answers 503 naming cat-factory when it is not configured', async () => {
    const review = await openReview(harness)
    const res = await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { code: 'unavailable' } })
  })
})
