import type { PullRequestRef } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { appTokenSource, staticTokenSource } from './credentials.js'
import { GitHubVcsGateway } from './GitHubVcsGateway.js'

// The wire shape of the two writes and the one read, against a stubbed fetch.
// Worth pinning: `requested_reviewers` and `issues/{n}/comments` are the two
// endpoints a reviewer never gets notified by if they are wrong.

const PR: PullRequestRef = {
  provider: 'github',
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 7,
  url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
}

interface Recorded {
  method: string
  path: string
  authorization: string
  body: unknown
}

function stub(
  status = 200,
  payload: unknown = {},
): {
  fetchImpl: typeof globalThis.fetch
  calls: Recorded[]
} {
  const calls: Recorded[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({
      method: init?.method ?? 'GET',
      path: new URL(String(url)).pathname,
      authorization: headers.authorization ?? '',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, calls }
}

describe('GitHubVcsGateway', () => {
  it('mirrors an assignment onto the pull request', async () => {
    const { fetchImpl, calls } = stub()
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    await gateway.requestReviewers(PR, ['alice', 'bob'])
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/repos/kibertoad/sainte-beuve/pulls/7/requested_reviewers',
      authorization: 'Bearer ghp_x',
      body: { reviewers: ['alice', 'bob'] },
    })
  })

  it('does not call GitHub when there is nobody to request', async () => {
    const { fetchImpl, calls } = stub()
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    await gateway.requestReviewers(PR, [])
    expect(calls).toHaveLength(0)
  })

  it('comments through the issues endpoint, because a pull request is an issue', async () => {
    const { fetchImpl, calls } = stub()
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    await gateway.comment(PR, 'Review requested from Alice.')
    expect(calls[0]).toMatchObject({
      path: '/repos/kibertoad/sainte-beuve/issues/7/comments',
      body: { body: 'Review requested from Alice.' },
    })
  })

  it('carries GitHub own refusal, so a missing permission is named', async () => {
    const { fetchImpl } = stub(403, { message: 'Resource not accessible by integration' })
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    // The status alone sends an operator looking for a deleted repository; the
    // body is the only place the missing permission appears.
    await expect(gateway.comment(PR, 'hello')).rejects.toThrow(
      /403 .*Resource not accessible by integration/,
    )
  })

  it('reads the account behind a credential that has one', async () => {
    const { fetchImpl, calls } = stub(200, { login: 'kibertoad' })
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    expect(await gateway.identify()).toBe('kibertoad')
    // Memoised: a status screen that polls must not spend a request per poll.
    expect(await gateway.identify()).toBe('kibertoad')
    expect(calls).toHaveLength(1)
  })

  it('answers no account for an App, without asking GitHub', async () => {
    const { fetchImpl, calls } = stub()
    const auth = {
      tokenForRepo: async () => 'ghs_installation',
      appJwt: async () => 'jwt',
      installationForRepo: async () => 1,
    }
    const gateway = new GitHubVcsGateway({
      tokens: appTokenSource(auth as never),
      fetchImpl,
    })

    // `GET /user` under an installation token is a 403, which would otherwise be
    // reported to an operator as a broken connection.
    expect(await gateway.identify()).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('authenticates a repository call with the installation token for that repository', async () => {
    const { fetchImpl, calls } = stub()
    const asked: string[] = []
    const auth = {
      tokenForRepo: async (owner: string, repo: string) => {
        asked.push(`${owner}/${repo}`)
        return 'ghs_installation'
      },
    }
    const gateway = new GitHubVcsGateway({ tokens: appTokenSource(auth as never), fetchImpl })

    await gateway.comment(PR, 'hello')
    expect(asked).toStrictEqual(['kibertoad/sainte-beuve'])
    expect(calls[0]?.authorization).toBe('Bearer ghs_installation')
  })
})
