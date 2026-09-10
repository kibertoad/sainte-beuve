import type { Reviewer } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { type TestHarness, addReviewer, buildHarness, get, patch, post } from './helpers.js'

/**
 * The reviewer directory, which the Configuration of the pool goes through.
 *
 * It is a small surface and the one every other feature leans on: selection
 * matches on the skills, an attention request addresses its audience by them and
 * by the team, and the workspace renders for the person a host account was
 * adopted onto. A directory nobody can edit is all three of those, broken.
 */
describe('reviewer directory API', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = buildHarness()
  })

  it('creates a reviewer on the contract defaults, with nothing outstanding', async () => {
    const created = await addReviewer(harness, { displayName: 'Ada' })

    expect(created).toMatchObject({
      displayName: 'Ada',
      handles: { github: null, gitlab: null },
      slackUserId: null,
      team: null,
      skills: [],
      availability: 'available',
      weight: 1,
      outstandingReviews: 0,
    })
  })

  it('patches one field and leaves the rest of the row alone', async () => {
    const created = await addReviewer(harness, {
      displayName: 'Ada',
      handles: { github: 'ada' },
      team: 'platform',
      skills: ['payments'],
    })

    const res = await harness.app.fetch(
      patch(`/api/v1/reviewers/${created.id}`, { availability: 'paused' }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      id: created.id,
      availability: 'paused',
      handles: { github: 'ada', gitlab: null },
      team: 'platform',
      skills: ['payments'],
    })
  })

  /**
   * The handles map is replaced wholesale, which is what the contract says and
   * what the screen sending it relies on: the form holds a box per host, so a
   * patch naming only GitHub is somebody having CLEARED the GitLab box, not
   * somebody who forgot to mention it.
   */
  it('replaces the whole handles map, so a patch naming one host clears the other', async () => {
    const created = await addReviewer(harness, {
      displayName: 'Ada',
      handles: { github: 'ada', gitlab: 'ada.l' },
    })

    const res = await harness.app.fetch(
      patch(`/api/v1/reviewers/${created.id}`, { handles: { github: 'ada' } }),
    )

    expect(await res.json()).toMatchObject({ handles: { github: 'ada', gitlab: null } })
  })

  /**
   * `outstandingReviews` is not on the patch schema, so a body carrying it is
   * stripped rather than obeyed. It is the counter selection damps the load
   * with, and it is owned by assigning and resolving a review; a directory screen
   * that could set it would let somebody hand themselves the next five reviews.
   */
  it('refuses to let the load counter be set through the directory', async () => {
    const created = await addReviewer(harness, { displayName: 'Ada' })

    const res = await harness.app.fetch(
      patch(`/api/v1/reviewers/${created.id}`, { outstandingReviews: 99, team: 'platform' }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ outstandingReviews: 0, team: 'platform' })
  })

  it('refuses a body the contract does not describe', async () => {
    const res = await harness.app.fetch(post('/api/v1/reviewers', { displayName: '   ' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'validation' } })
  })

  it('answers 404 for a reviewer that is not there', async () => {
    const res = await harness.app.fetch(patch('/api/v1/reviewers/nobody', { team: 'platform' }))

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'not_found', message: /nobody/ } })
  })

  it('lists everybody in the pool', async () => {
    await addReviewer(harness, { displayName: 'Ada' })
    await addReviewer(harness, { displayName: 'Grace', availability: 'paused' })

    const res = await harness.app.fetch(get('/api/v1/reviewers'))

    expect(res.status).toBe(200)
    const { reviewers } = (await res.json()) as { reviewers: Reviewer[] }
    // Paused people stay in the directory: `paused` is the way out of the POOL,
    // not out of the team, and a screen that hid them would offer no way back.
    expect(reviewers.map((reviewer) => reviewer.displayName).sort()).toEqual(['Ada', 'Grace'])
  })
})
