import type { ReviewRequest } from '@sainte-beuve/contracts'
import type { AiReviewGateway } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { ReviewService } from '../src/modules/reviews/ReviewService.js'
import {
  addReviewer,
  buildHarness,
  openReview,
  recordingVcs,
  stubGateways,
  type TestHarness,
} from './helpers.js'

// GitHub deliveries through the app: the signature gate, the intent, and the
// writes, together. What each payload MEANS is tested against fixtures in
// @sainte-beuve/integrations; what this suite covers is the half that touches
// the store and answers HTTP.

const SECRET = 'webhook-secret'
const PATH = '/webhooks/github'
const PR_URL = 'https://github.com/kibertoad/sainte-beuve/pull/7'
const REPOSITORY = { name: 'sainte-beuve', owner: { login: 'kibertoad' } }

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return `sha256=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

async function deliver(
  harness: TestHarness,
  event: string,
  payload: unknown,
  secret = SECRET,
): Promise<Response> {
  const body = JSON.stringify(payload)
  return harness.app.fetch(
    new Request(`http://localhost${PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-GitHub-Event': event,
        'X-Hub-Signature-256': await sign(body, secret),
      },
      body,
    }),
  )
}

function pullRequestPayload(action: string, extra: Record<string, unknown> = {}): unknown {
  return {
    action,
    repository: REPOSITORY,
    pull_request: {
      number: 7,
      title: 'Add a health check',
      html_url: PR_URL,
      draft: false,
      user: { login: 'author' },
      labels: [],
    },
    ...extra,
  }
}

function commentPayload(body: string): unknown {
  return {
    action: 'created',
    repository: REPOSITORY,
    issue: {
      number: 7,
      title: 'Add a health check',
      html_url: 'https://github.com/kibertoad/sainte-beuve/issues/7',
      user: { login: 'author' },
      labels: [],
      pull_request: { html_url: PR_URL },
    },
    comment: { body, user: { login: 'reviewer' } },
  }
}

async function tracked(harness: TestHarness): Promise<ReviewRequest[]> {
  return harness.container.repositories.reviews.list()
}

describe('GitHub webhook intake', () => {
  let harness: TestHarness
  let vcs: ReturnType<typeof recordingVcs>

  beforeEach(() => {
    vcs = recordingVcs()
    harness = buildHarness({
      vcs,
      github: {
        appSlug: null,
        webhookSecret: SECRET,
        botLogin: 'sainte-beuve-bot',
        labels: { review: 'needs-review', aiReview: 'ai-review', skillPrefix: 'skill:' },
      },
    })
  })

  it('refuses a delivery this deployment cannot verify', async () => {
    // No secret configured: every delivery is a stranger's POST, and acting on
    // one would let anybody close a review.
    const unconfigured = buildHarness()
    const res = await deliver(unconfigured, 'pull_request', pullRequestPayload('opened'))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: { code: 'unavailable', message: expect.stringContaining('GITHUB_WEBHOOK_SECRET') },
    })
  })

  it('refuses a delivery signed with the wrong secret', async () => {
    const res = await deliver(harness, 'pull_request', pullRequestPayload('opened'), 'other')
    expect(res.status).toBe(403)
    expect(await tracked(harness)).toStrictEqual([])
  })

  it('tracks an opened pull request and leaves it unassigned', async () => {
    await addReviewer(harness, { displayName: 'Peer', githubLogin: 'peer' })
    const res = await deliver(harness, 'pull_request', pullRequestPayload('opened'))

    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ action: 'tracked' })
    const [review] = await tracked(harness)
    expect(review).toMatchObject({ status: 'open', assignedReviewerIds: [] })
    // Nobody was asked: opening a pull request is not the same gesture as asking
    // for a reviewer.
    expect(vcs.requested).toStrictEqual([])
  })

  it('converges on one review when GitHub redelivers', async () => {
    await deliver(harness, 'pull_request', pullRequestPayload('opened'))
    const again = await deliver(harness, 'pull_request', pullRequestPayload('opened'))

    expect(await again.json()).toMatchObject({ action: 'already_tracked' })
    expect(await tracked(harness)).toHaveLength(1)
  })

  it('routes the review when the review label lands, and mirrors it onto the PR', async () => {
    await addReviewer(harness, { displayName: 'Peer', githubLogin: 'peer', skills: ['payments'] })
    const res = await deliver(
      harness,
      'pull_request',
      pullRequestPayload('labeled', {
        label: { name: 'needs-review' },
        pull_request: {
          number: 7,
          title: 'Add a health check',
          html_url: PR_URL,
          draft: false,
          user: { login: 'author' },
          labels: [{ name: 'skill:payments' }],
        },
      }),
    )

    expect(await res.json()).toMatchObject({ action: 'assigned' })
    const [review] = await tracked(harness)
    expect(review).toMatchObject({ status: 'assigned', requiredSkills: ['payments'] })
    expect(vcs.requested).toStrictEqual([['peer']])
  })

  it('says so rather than failing when the pool holds nobody with the skill', async () => {
    await addReviewer(harness, { displayName: 'Peer', githubLogin: 'peer', skills: [] })
    const res = await deliver(
      harness,
      'pull_request',
      pullRequestPayload('labeled', {
        label: { name: 'needs-review' },
        pull_request: {
          number: 7,
          title: 'Add a health check',
          html_url: PR_URL,
          draft: false,
          user: { login: 'author' },
          labels: [{ name: 'skill:payments' }],
        },
      }),
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ action: 'no_reviewer_available' })
  })

  it('resolves the review when a review is submitted', async () => {
    await deliver(harness, 'pull_request', pullRequestPayload('opened'))
    const res = await deliver(
      harness,
      'pull_request_review',
      pullRequestPayload('submitted', { review: { state: 'approved' } }),
    )

    expect(await res.json()).toMatchObject({ action: 'approved' })
    expect((await tracked(harness))[0]).toMatchObject({ status: 'approved' })
  })

  it('closes the review when the pull request closes', async () => {
    await deliver(harness, 'pull_request', pullRequestPayload('opened'))
    await deliver(harness, 'pull_request', pullRequestPayload('closed'))
    expect((await tracked(harness))[0]).toMatchObject({ status: 'closed' })
  })

  it('ignores an event about a pull request nobody tracked', async () => {
    // A repository has open pull requests that predate the App, and closing one
    // of those is simply not our business.
    const res = await deliver(harness, 'pull_request', pullRequestPayload('closed'))
    expect(await res.json()).toMatchObject({ action: 'ignored' })
    expect(await tracked(harness)).toStrictEqual([])
  })

  it('delegates to cat-factory when the AI-review label lands on an untracked PR', async () => {
    const aiReview: AiReviewGateway = {
      requestReview: async () => ({ taskId: 'task-1', url: 'https://cat.example/task-1' }),
      getStatus: async () => ({ status: 'running', summary: null, failureReason: null }),
    }
    const delegating = buildHarness({
      aiReview,
      github: harness.container.github,
    })

    const res = await deliver(
      delegating,
      'pull_request',
      pullRequestPayload('labeled', { label: { name: 'ai-review' } }),
    )
    expect(await res.json()).toMatchObject({ action: 'ai_review:running' })
    // Tracked on the way: a run belongs to a review request, and labelling an
    // untracked pull request is a sensible way to ask for one.
    expect(await tracked(delegating)).toHaveLength(1)
  })

  it('answers a bot mention on the pull request, including when it refuses', async () => {
    await addReviewer(harness, { displayName: 'Peer', githubLogin: 'peer' })
    await deliver(harness, 'issue_comment', commentPayload('@sainte-beuve-bot review'))
    expect(vcs.comments.at(-1)?.body).toContain('Review requested from Peer')

    // cat-factory is not configured here, and the refusal names the missing
    // configuration where the person who asked is looking.
    await deliver(harness, 'issue_comment', commentPayload('@sainte-beuve-bot ai'))
    expect(vcs.comments.at(-1)?.body).toContain('cat-factory is not configured')
  })

  it('reports the state of a tracked review, and offers to track an untracked one', async () => {
    await deliver(harness, 'issue_comment', commentPayload('@sainte-beuve-bot status'))
    expect(vcs.comments.at(-1)?.body).toContain('not on the review board yet')

    await openReview(harness)
    await deliver(harness, 'issue_comment', commentPayload('@sainte-beuve-bot status'))
    expect(vcs.comments.at(-1)?.body).toContain('Status **open**')
  })

  it('hands a reroll to somebody other than whoever already has it', async () => {
    const first = await addReviewer(harness, { displayName: 'First', githubLogin: 'first' })
    await addReviewer(harness, { displayName: 'Second', githubLogin: 'second' })
    const review = await openReview(harness)
    await new ReviewService(harness.container).claim(review.id, first.id)

    await deliver(harness, 'issue_comment', commentPayload('@sainte-beuve-bot reroll'))
    expect(vcs.comments.at(-1)?.body).toContain('Second')
  })

  it('stays quiet for an event it does not read', async () => {
    const res = await deliver(harness, 'push', { repository: REPOSITORY })
    expect(res.status).toBe(202)
    expect(await res.json()).toStrictEqual({ action: 'ignored', reviewId: null })
  })

  it('reaches GitHub with the credential the deployment resolved', async () => {
    // The reply goes out through whichever credential wins, which here is the
    // App: the point is that a bot answer is not tied to the environment token.
    const asApp = recordingVcs()
    const appWired = buildHarness({
      github: harness.container.github,
      gateways: stubGateways({ vcsAsApp: asApp }),
    })
    await addReviewer(appWired, { displayName: 'Peer', githubLogin: 'peer' })
    await deliver(appWired, 'issue_comment', commentPayload('@sainte-beuve-bot review'))
    expect(asApp.comments).toHaveLength(1)
    expect(asApp.requested).toStrictEqual([['peer']])
  })
})
