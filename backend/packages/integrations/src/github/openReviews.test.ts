import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { staticTokenSource } from './credentials.js'
import { GitHubVcsGateway } from './GitHubVcsGateway.js'

const PROJECT = { provider: 'github' as const, owner: 'platform', repo: 'api' }

function reviewBy(login: string, kind = 'User') {
  return { author: { __typename: kind, login } }
}

function openPull(number: number, author: string | null, reviews: unknown[]) {
  return { number, author: author === null ? null : { login: author }, reviews: { nodes: reviews } }
}

function pulls(...nodes: ReturnType<typeof openPull>[]) {
  return page(null, nodes)
}

function page(endCursor: string | null, nodes: ReturnType<typeof openPull>[]) {
  const pageInfo = { hasNextPage: endCursor !== null, endCursor }
  return { data: { repository: { pullRequests: { pageInfo, nodes } } } }
}

interface Recorded {
  url: string
  body: { query: string; variables: unknown }
}

function answering(...payloads: unknown[]): {
  fetchImpl: typeof globalThis.fetch
  calls: Recorded[]
} {
  const calls: Recorded[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Recorded['body'] })
    const payload = payloads[Math.min(calls.length, payloads.length) - 1]
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, calls }
}

function gateway(fetchImpl: typeof globalThis.fetch): GitHubVcsGateway {
  return new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })
}

describe('GitHubVcsGateway.openPullRequestReviews', () => {
  it('lists who reviewed each open pull request once, in one GraphQL call', async () => {
    const { fetchImpl, calls } = answering(
      pulls(
        openPull(7, 'ann', [reviewBy('Bea'), reviewBy('bea'), reviewBy('cid')]),
        openPull(8, 'bea', []),
      ),
    )

    expect(await gateway(fetchImpl).openPullRequestReviews(PROJECT)).toStrictEqual([
      { number: 7, reviewerLogins: ['Bea', 'cid'] },
      { number: 8, reviewerLogins: [] },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.github.com/graphql')
    expect(calls[0]?.body.variables).toStrictEqual({ owner: 'platform', name: 'api', after: null })
    expect(calls[0]?.body.query).toContain('states: OPEN')
  })

  it('follows the pages past the first hundred', async () => {
    const { fetchImpl, calls } = answering(
      page('cursor-1', [openPull(7, 'ann', [reviewBy('bea')])]),
      page(null, [openPull(3, 'ann', [])]),
    )
    expect(await gateway(fetchImpl).openPullRequestReviews(PROJECT)).toStrictEqual([
      { number: 7, reviewerLogins: ['bea'] },
      { number: 3, reviewerLogins: [] },
    ])
    expect(calls.map((call) => call.body.variables)).toStrictEqual([
      { owner: 'platform', name: 'api', after: null },
      { owner: 'platform', name: 'api', after: 'cursor-1' },
    ])
  })

  it('asks for submitted reviews only, never a pending draft', async () => {
    const { fetchImpl, calls } = answering(pulls())
    await gateway(fetchImpl).openPullRequestReviews(PROJECT)
    expect(calls[0]?.body.query).toContain(
      'states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]',
    )
  })

  it('leaves out the author and bots', async () => {
    const { fetchImpl } = answering(
      pulls(
        openPull(7, 'Ann', [
          reviewBy('ann'),
          reviewBy('copilot', 'Bot'),
          { author: null },
          reviewBy('bea'),
        ]),
      ),
    )
    expect(await gateway(fetchImpl).openPullRequestReviews(PROJECT)).toStrictEqual([
      { number: 7, reviewerLogins: ['bea'] },
    ])
  })

  it('answers nothing for a repository GitHub does not show this credential', async () => {
    const { fetchImpl } = answering({ data: { repository: null } })
    expect(await gateway(fetchImpl).openPullRequestReviews(PROJECT)).toStrictEqual([])
  })

  it('fails on a GraphQL refusal, which arrives with a 200', async () => {
    const { fetchImpl } = answering({ data: null, errors: [{ message: 'rate limited' }] })
    await expect(gateway(fetchImpl).openPullRequestReviews(PROJECT)).rejects.toThrow(
      UpstreamFailedError,
    )
  })
})
