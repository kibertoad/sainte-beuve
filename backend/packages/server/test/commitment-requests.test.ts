import type { AttentionRequest, ReviewCommitment } from '@sainte-beuve/contracts'
import type { VcsGateway } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { ReviewService } from '../src/modules/reviews/ReviewService.js'
import {
  addReviewer,
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
      return logins
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
    expect(commitment.requestedHandle).toBe('kibertoad')
    expect(github.requested).toStrictEqual([['kibertoad']])

    await release(harness, commitment)
    expect(github.withdrawn).toStrictEqual([['kibertoad']])
  })

  it('leaves a request somebody else made where it was', async () => {
    // The author asked for them on the host before they committed here.
    const github = host('kibertoad', ['Kibertoad'])
    const harness = harnessOn(github)

    const commitment = await commit(harness)
    expect(commitment.requestedHandle).toBeNull()
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

  it('keeps the request a commitment relies on when the board rerolls the same person', async () => {
    const github = host('kibertoad')
    const harness = harnessOn(github)
    const commitment = await commit(harness)
    await addReviewer(harness, { displayName: 'Second', handles: { github: 'second' } })
    const review = await openReview(harness)
    await harness.container.repositories.reviews.update(review.id, {
      status: 'assigned',
      assignedReviewerIds: [commitment.reviewerId],
    })

    await new ReviewService(harness.container).reroll(review.id)
    expect(github.withdrawn).toStrictEqual([])
    expect(github.requested.at(-1)).toStrictEqual(['second'])
  })

  it('hands a rerolled board request to the commitment, which takes it back on release', async () => {
    // The board requested them first, so committing found them pending and claimed nothing.
    const github = host('kibertoad', ['kibertoad'])
    const harness = harnessOn(github)
    const commitment = await commit(harness)
    expect(commitment.requestedHandle).toBeNull()
    await addReviewer(harness, { displayName: 'Second', handles: { github: 'second' } })
    const review = await openReview(harness)
    await harness.container.repositories.reviews.update(review.id, {
      status: 'assigned',
      assignedReviewerIds: [commitment.reviewerId],
    })

    await new ReviewService(harness.container).reroll(review.id)
    expect(github.withdrawn).toStrictEqual([])

    await release(harness, commitment)
    expect(github.withdrawn).toStrictEqual([['kibertoad']])
  })

  it('claims the request on the row before it goes out', async () => {
    const github = host('kibertoad')
    let claimedWhenSent: string | null | undefined
    const harness = harnessOn(github)
    const send = github.gateway.requestReviewers
    github.gateway.requestReviewers = async (pr, logins) => {
      const { repositories } = harness.container
      const viewer = (await repositories.reviewers.list()).find(
        (r) => r.handles.github === 'kibertoad',
      )
      const [row] = await repositories.commitments.listByReviewer(viewer?.id ?? '')
      claimedWhenSent = row?.requestedHandle
      return send(pr, logins)
    }

    await commit(harness)
    expect(claimedWhenSent).toBe('kibertoad')
  })

  it('drops the claim when the request does not land', async () => {
    const github = host('kibertoad')
    github.gateway = {
      ...github.gateway,
      requestReviewers: () => Promise.reject(new Error('GitHub answered 502')),
    }
    const harness = harnessOn(github)

    const commitment = await commit(harness)
    expect(commitment.requestedHandle).toBeNull()
    const stored = await harness.container.repositories.commitments.getById(commitment.id)
    expect(stored?.requestedHandle).toBeNull()
  })

  it('claims nothing when the host takes the request as a no-op', async () => {
    // GitLab keeps a reviewer who has reviewed on the list, and adding them again changes nothing.
    const github = host('kibertoad')
    github.gateway = { ...github.gateway, requestReviewers: async () => [] }
    const harness = harnessOn(github)

    const commitment = await commit(harness)
    expect(commitment.requestedHandle).toBeNull()

    // The author asks them again on the host; that request is the author's to keep.
    github.pending = ['kibertoad']
    await release(harness, commitment)
    expect(github.withdrawn).toStrictEqual([])
  })

  it('withdraws the handle the commitment requested, whatever the reviewer is called now', async () => {
    const github = host('kibertoad', ['old-login'])
    const harness = harnessOn(github)
    const commitment = await commit(harness)
    await harness.container.repositories.commitments.setRequestedHandle(commitment.id, 'old-login')

    await release(harness, commitment)
    expect(github.withdrawn).toStrictEqual([['old-login']])
  })

  it('keeps the promise when the host cannot be reached', async () => {
    const github = host('kibertoad')
    github.gateway = {
      ...github.gateway,
      pendingReviewers: () => Promise.reject(new Error('GitHub answered 502')),
    }
    const harness = harnessOn(github)

    const commitment = await commit(harness)
    expect(commitment.requestedHandle).toBeNull()
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
