import { describe, expect, it } from 'vitest'
import {
  type PullRequestEventPayload,
  reviewRequestFromPullRequestEvent,
  verifyGitHubSignature,
} from './webhooks.js'

const SECRET = 'github-webhook-secret'
const BODY = '{"action":"opened"}'

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `sha256=${hex}`
}

function payload(overrides: Partial<PullRequestEventPayload> = {}): PullRequestEventPayload {
  return {
    action: 'opened',
    pull_request: {
      number: 42,
      title: 'Add a health check',
      html_url: 'https://github.com/kibertoad/sainte-beuve/pull/42',
      draft: false,
      user: { login: 'kibertoad' },
    },
    repository: { name: 'sainte-beuve', owner: { login: 'kibertoad' } },
    ...overrides,
  }
}

describe('verifyGitHubSignature', () => {
  it('accepts a correctly signed body', async () => {
    expect(await verifyGitHubSignature(SECRET, BODY, await sign(BODY))).toBe(true)
  })

  it('rejects a signature made with another secret', async () => {
    expect(await verifyGitHubSignature(SECRET, BODY, await sign(BODY, 'other'))).toBe(false)
  })

  it('rejects a missing or malformed header', async () => {
    expect(await verifyGitHubSignature(SECRET, BODY, null)).toBe(false)
    expect(await verifyGitHubSignature(SECRET, BODY, 'sha1=deadbeef')).toBe(false)
    expect(await verifyGitHubSignature(SECRET, BODY, 'sha256=zz')).toBe(false)
  })
})

describe('reviewRequestFromPullRequestEvent', () => {
  it('opens a review for a newly opened pull request', () => {
    const created = reviewRequestFromPullRequestEvent(payload())
    expect(created?.pullRequest).toStrictEqual({
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 42,
      url: 'https://github.com/kibertoad/sainte-beuve/pull/42',
    })
    expect(created?.authorLogin).toBe('kibertoad')
  })

  it('ignores drafts and untracked actions', () => {
    expect(
      reviewRequestFromPullRequestEvent(
        payload({ pull_request: { ...payload().pull_request, draft: true } }),
      ),
    ).toBeNull()
    expect(reviewRequestFromPullRequestEvent(payload({ action: 'labeled' }))).toBeNull()
  })

  it('marks the author unknown rather than dropping a PR from a deleted account', () => {
    const created = reviewRequestFromPullRequestEvent(
      payload({ pull_request: { ...payload().pull_request, user: null } }),
    )
    expect(created?.authorLogin).toBe('unknown')
  })
})
