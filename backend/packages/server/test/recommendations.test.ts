import type { ReviewerRecommendations } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  PR,
  type TestHarness,
  addReviewer,
  assignReviewer,
  buildHarness,
  environmentVcs,
  openReview,
  patch,
  post,
  viewerVcs,
} from './helpers.js'

// The ranking itself is tested in @sainte-beuve/reviewers. This suite covers
// what the route adds: where the wanted skills come from, and who is left out.

const RECOMMEND = '/api/v1/reviewers/recommendations'

/** A deployment whose credential acts as `me`, so that is who the viewer is. */
function harness(): TestHarness {
  return buildHarness({ vcs: environmentVcs(viewerVcs('me')) })
}

async function recommend(
  h: TestHarness,
  body: Record<string, unknown> = {},
): Promise<ReviewerRecommendations> {
  const res = await h.app.fetch(post(RECOMMEND, { pullRequest: PR, ...body }))
  expect(res.status).toBe(200)
  return (await res.json()) as ReviewerRecommendations
}

function names(result: ReviewerRecommendations): string[] {
  return result.recommendations.map((entry) => entry.displayName)
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

describe('reviewer recommendations', () => {
  it('ranks on the asked skills and the repository domains, and says why', async () => {
    const h = harness()
    await addReviewer(h, { displayName: 'Me', handles: { github: 'me' }, skills: ['go'] })
    await addReviewer(h, { displayName: 'Generalist', handles: { github: 'gen' } })
    await addReviewer(h, {
      displayName: 'Expert',
      handles: { github: 'exp' },
      skills: ['Payments'],
      domains: ['billing'],
    })
    await registerProject(h, ['Backend'], ['billing'])

    const result = await recommend(h, { requiredSkills: ['payments'] })

    expect(result.wanted).toStrictEqual({ skills: ['payments'], domains: ['billing'] })
    expect(names(result)).toStrictEqual(['Expert', 'Generalist'])
    expect(result.recommendations[0]?.reasons).toStrictEqual({
      matchedSkills: ['payments'],
      matchedDomains: ['billing'],
      outstandingReviews: 0,
      pastReviews: 0,
    })
    expect(result.shortfallReason).toBeNull()
  })

  it('ranks somebody who reviewed the repository before above an equal stranger', async () => {
    const h = buildHarness({ random: () => 0, vcs: environmentVcs(viewerVcs('me')) })
    await addReviewer(h, { displayName: 'Rae', handles: { github: 'rae' } })
    await addReviewer(h, { displayName: 'Alex', handles: { github: 'alex' } })
    await addReviewer(h, { displayName: 'Me', handles: { github: 'me' } })
    // An earlier pull request in the same repository, which Rae reviewed: the
    // first draw goes to the first eligible reviewer in directory order.
    const earlier = await openReview(h, { pullRequest: { ...PR, number: 3, url: `${PR.url}3` } })
    expect((await assignReviewer(h, earlier.id)).status).toBe(200)
    const approved = await h.app.fetch(
      patch(`/api/v1/reviews/${earlier.id}/status`, { status: 'approved' }),
    )
    expect(approved.status).toBe(200)

    const result = await recommend(h)

    expect(names(result)).toStrictEqual(['Rae', 'Alex'])
    expect(result.recommendations.map((entry) => entry.reasons.pastReviews)).toStrictEqual([1, 0])
  })

  it("wants the board row's skills, then the repository's, when the caller names none", async () => {
    const h = harness()
    await registerProject(h, ['Backend'], [])
    expect((await recommend(h)).wanted.skills).toStrictEqual(['Backend'])

    await openReview(h, { requiredSkills: ['typescript'] })
    expect((await recommend(h)).wanted.skills).toStrictEqual(['typescript'])
  })

  it("leaves out the caller, the board row's author and whoever is already on it", async () => {
    const h = buildHarness({ random: () => 0, vcs: environmentVcs(viewerVcs('me')) })
    await addReviewer(h, { displayName: 'Assigned', handles: { github: 'assigned' } })
    await addReviewer(h, { displayName: 'Author', handles: { github: 'AUTHOR' } })
    await addReviewer(h, { displayName: 'Me', handles: { github: 'me' } })
    await addReviewer(h, { displayName: 'Free', handles: { github: 'free' } })
    const review = await openReview(h, { authorLogin: 'author' })
    // The first draw goes to the first eligible reviewer in directory order.
    expect((await assignReviewer(h, review.id)).status).toBe(200)

    expect(names(await recommend(h))).toStrictEqual(['Free'])
  })

  it('says why the list is empty', async () => {
    const h = harness()
    await addReviewer(h, { displayName: 'Me', handles: { github: 'me' } })

    const result = await recommend(h)

    expect(result.recommendations).toStrictEqual([])
    expect(result.shortfallReason).toBe('all_excluded')
  })

  it('refuses a limit past the cap', async () => {
    const res = await harness().app.fetch(post(RECOMMEND, { pullRequest: PR, limit: 26 }))
    expect(res.status).toBe(400)
  })
})
