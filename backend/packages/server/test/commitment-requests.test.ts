import type { AttentionRequest, ReviewCommitment } from '@sainte-beuve/contracts'
import type { VcsGateway } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import {
  buildHarness,
  del,
  environmentVcs,
  openReview,
  PR,
  post,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// A commitment puts the reviewer on the pull request, and releasing it takes
// back only what it put there. The host is a double that remembers who it is
// waiting on, so a case can watch a request land and leave.

interface Host {
  gateway: VcsGateway
  pending: string[]
  requested: string[][]
  withdrawn: string[][]
}

function host(username: string, pending: string[] = []): Host {
  const state: Host = {
    gateway: viewerVcs(username),
    pending: [...pending],
    requested: [],
    withdrawn: [],
  }
  state.gateway = {
    ...viewerVcs(username),
    pendingReviewers: async () => [...state.pending],
    requestReviewers: async (_pr, logins) => {
      state.requested.push(logins)
      state.pending.push(...logins)
    },
    removeRequestedReviewers: async (_pr, logins) => {
      state.withdrawn.push(logins)
      state.pending = state.pending.filter((login) => !logins.includes(login))
    },
  }
  return state
}

function harnessOn(state: Host): TestHarness {
  return buildHarness({ vcs: environmentVcs(state.gateway) })
}

async function commit(harness: TestHarness): Promise<ReviewCommitment> {
  const res = await harness.app.fetch(
    post('/api/v1/commitments', { pullRequest: PR, title: 'Saw it go by' }),
  )
  expect(res.status).toBe(201)
  return (await res.json()) as ReviewCommitment
}

async function release(harness: TestHarness, commitment: ReviewCommitment): Promise<void> {
  const res = await harness.app.fetch(del(`/api/v1/commitments/${commitment.id}`))
  expect(res.status).toBe(200)
}

describe('a commitment on the host', () => {
  it('requests the committer, and withdraws the request when released', async () => {
    const github = host('kibertoad')
    const harness = harnessOn(github)

    const commitment = await commit(harness)
    expect(commitment.requestedOnHost).toBe(true)
    expect(github.requested).toStrictEqual([['kibertoad']])

    await release(harness, commitment)
    expect(github.withdrawn).toStrictEqual([['kibertoad']])
  })

  it('leaves a request somebody else made where it was', async () => {
    // The author asked for them on the host before they committed here.
    const github = host('kibertoad', ['Kibertoad'])
    const harness = harnessOn(github)

    const commitment = await commit(harness)
    expect(commitment.requestedOnHost).toBe(false)
    expect(github.requested).toStrictEqual([])

    await release(harness, commitment)
    expect(github.withdrawn).toStrictEqual([])
  })

  it('never takes a request back from somebody who has reviewed since', async () => {
    const github = host('kibertoad')
    const harness = harnessOn(github)
    const commitment = await commit(harness)

    // A submitted review is what takes them off the host's pending list.
    github.pending = []
    await release(harness, commitment)
    expect(github.withdrawn).toStrictEqual([])
  })

  it('keeps the request a board assignment of the same person relies on', async () => {
    const github = host('kibertoad')
    const harness = harnessOn(github)
    const commitment = await commit(harness)
    const review = await openReview(harness)
    await harness.container.repositories.reviews.update(review.id, {
      status: 'assigned',
      assignedReviewerIds: [commitment.reviewerId],
    })

    await release(harness, commitment)
    expect(github.withdrawn).toStrictEqual([])
  })

  it('keeps the promise when the host cannot be reached', async () => {
    const github = host('kibertoad')
    github.gateway = {
      ...github.gateway,
      pendingReviewers: () => Promise.reject(new Error('GitHub answered 502')),
    }
    const harness = harnessOn(github)

    const commitment = await commit(harness)
    expect(commitment.requestedOnHost).toBe(false)
    expect(github.requested).toStrictEqual([])
  })

  it('requests whoever answers an attention request', async () => {
    const asker = harnessOn(host('author'))
    const raised = await asker.app.fetch(
      post('/api/v1/attention', { pullRequest: PR, title: 'Add a health check' }),
    )
    const request = (await raised.json()) as AttentionRequest
    const github = host('peer')
    const peer = buildHarness({ ...asker.container, vcs: environmentVcs(github.gateway) })

    const res = await peer.app.fetch(post(`/api/v1/attention/${request.id}/commit`, {}))
    expect(res.status).toBe(200)
    expect(github.requested).toStrictEqual([['peer']])
  })
})
