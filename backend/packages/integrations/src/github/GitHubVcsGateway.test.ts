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

/** Answers each call from a queue of pages, so a paged read can be scripted. */
function pagedStub(pages: unknown[][]): { fetchImpl: typeof globalThis.fetch; urls: string[] } {
  const urls: string[] = []
  const queue = [...pages]
  const fetchImpl = (async (url: string | URL | Request) => {
    urls.push(String(url))
    return new Response(JSON.stringify(queue.shift() ?? []), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, urls }
}

/** `count` open pull requests, numbered from `start`. */
function openPulls(start: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    number: start + index,
    title: 'A change',
    html_url: `https://github.com/kibertoad/sainte-beuve/pull/${start + index}`,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
    user: { id: 1, login: 'author' },
  }))
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
    const { fetchImpl, calls } = stub(200, { id: 4249249, login: 'kibertoad', name: 'Igor' })
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    // The numeric id, not the login, is what an identity is keyed on: a handle
    // is renameable and the next person to claim it must not inherit the row.
    expect(await gateway.identify()).toStrictEqual({
      subject: '4249249',
      username: 'kibertoad',
      displayName: 'Igor',
      avatarUrl: null,
    })
    // Memoised: a status screen that polls must not spend a request per poll.
    await gateway.identify()
    expect(calls).toHaveLength(1)
  })

  it('lists the open pull requests of a repository with their author and reviewers', async () => {
    const { fetchImpl, calls } = stub(200, [
      {
        number: 7,
        title: 'Add a health check',
        html_url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
        draft: false,
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-02T10:00:00Z',
        user: { id: 1, login: 'author' },
        requested_reviewers: [{ id: 2, login: 'peer' }],
      },
    ])
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    const listed = await gateway.listOpenPullRequests({
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
    })

    // The list endpoint, not search: search is eventually consistent, so a pull
    // request opened seconds ago would be missing from a workspace read.
    expect(calls[0]?.path).toBe('/repos/kibertoad/sainte-beuve/pulls')
    expect(listed).toStrictEqual([
      {
        pullRequest: {
          provider: 'github',
          owner: 'kibertoad',
          repo: 'sainte-beuve',
          number: 7,
          url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
        },
        title: 'Add a health check',
        authorLogin: 'author',
        requestedReviewerLogins: ['peer'],
        draft: false,
        createdAt: Date.parse('2026-09-01T10:00:00Z'),
        updatedAt: Date.parse('2026-09-02T10:00:00Z'),
      },
    ])
  })

  it('follows the pages, so a repository past the first one is not truncated', async () => {
    // 100 is GitHub's own cap on `per_page`. A monorepo with more open pull
    // requests would otherwise drop the viewer's older one off the workspace
    // while the screen reported the project as read.
    const { fetchImpl, urls } = pagedStub([openPulls(1, 100), openPulls(101, 20)])
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    const listed = await gateway.listOpenPullRequests({
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
    })

    expect(listed).toHaveLength(120)
    // A short page is the last page, so the second answer ends the read.
    expect(urls.map((url) => new URL(url).searchParams.get('page'))).toStrictEqual(['1', '2'])
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
