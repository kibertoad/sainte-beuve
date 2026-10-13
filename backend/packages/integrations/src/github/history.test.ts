import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { staticTokenSource } from './credentials.js'
import { GitHubVcsGateway } from './GitHubVcsGateway.js'
import { graphqlBaseOf } from './history.js'

const PROJECT = { provider: 'github' as const, owner: 'platform', repo: 'api' }
const SINCE = Date.parse('2026-06-01T00:00:00Z')

function review(login: string | null, submittedAt: string | null = '2026-09-01T00:00:00Z') {
  return { submittedAt, author: login === null ? null : { login } }
}

interface Opened {
  by?: string | null
  at?: string
  kind?: string
}

function pull(updatedAt: string, reviews: ReturnType<typeof review>[], opened: Opened = {}) {
  const by = opened.by ?? null
  return {
    createdAt: opened.at ?? '2026-01-01T00:00:00Z',
    updatedAt,
    author: by === null ? null : { __typename: opened.kind ?? 'User', login: by },
    reviews: { nodes: reviews },
  }
}

function pulls(...nodes: ReturnType<typeof pull>[]) {
  return { data: { repository: { pullRequests: { nodes } } } }
}

interface Recorded {
  url: string
  method: string
  body: { query: string; variables: unknown }
}

function answering(payload: unknown): { fetchImpl: typeof globalThis.fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: JSON.parse(String(init?.body)) as Recorded['body'],
    })
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

describe('GitHubVcsGateway.pastActivity', () => {
  it('tallies each pull request once per reviewer, in one GraphQL call', async () => {
    const { fetchImpl, calls } = answering(
      pulls(
        pull('2026-09-02T00:00:00Z', [review('ann'), review('Ann'), review('bea')]),
        pull('2026-08-02T00:00:00Z', [review('ann'), review(null)]),
      ),
    )

    const activity = await gateway(fetchImpl).pastActivity(PROJECT, SINCE)

    expect(activity.reviewers).toStrictEqual([
      { login: 'ann', reviews: 2 },
      { login: 'bea', reviews: 1 },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.github.com/graphql')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body.variables).toStrictEqual({ owner: 'platform', name: 'api' })
    expect(calls[0]?.body.query).toContain('states: [APPROVED, CHANGES_REQUESTED]')
  })

  it('leaves out pull requests and verdicts older than the window', async () => {
    const { fetchImpl } = answering(
      pulls(
        pull('2026-09-02T00:00:00Z', [review('ann', '2026-01-01T00:00:00Z'), review('bea')]),
        pull('2026-01-02T00:00:00Z', [review('cid', '2026-01-01T00:00:00Z')]),
      ),
    )
    expect((await gateway(fetchImpl).pastActivity(PROJECT, SINCE)).reviewers).toStrictEqual([
      { login: 'bea', reviews: 1 },
    ])
  })

  it('tallies who opened the pull requests created in the window, folding case', async () => {
    const recent = '2026-07-01T00:00:00Z'
    const { fetchImpl } = answering(
      pulls(
        pull('2026-09-02T00:00:00Z', [], { by: 'Dan', at: recent }),
        pull('2026-09-01T00:00:00Z', [], { by: 'dan', at: '2026-06-01T00:00:00Z' }),
        pull('2026-08-02T00:00:00Z', [], { by: 'eve', at: recent }),
        pull('2026-08-01T00:00:00Z', [], { by: 'old', at: '2026-05-31T23:59:59Z' }),
        pull('2026-07-02T00:00:00Z', [], { by: 'dependabot', at: recent, kind: 'Bot' }),
        pull('2026-07-01T00:00:00Z', [], { by: null, at: recent }),
      ),
    )
    expect((await gateway(fetchImpl).pastActivity(PROJECT, SINCE)).authors).toStrictEqual([
      { login: 'Dan', pullRequests: 2 },
      { login: 'eve', pullRequests: 1 },
    ])
  })

  it('answers nobody for a repository GitHub does not show this credential', async () => {
    const { fetchImpl } = answering({ data: { repository: null } })
    expect(await gateway(fetchImpl).pastActivity(PROJECT, SINCE)).toStrictEqual({
      reviewers: [],
      authors: [],
    })
  })

  it('fails on a GraphQL refusal, which arrives with a 200', async () => {
    const { fetchImpl } = answering({ data: null, errors: [{ message: 'rate limited' }] })
    await expect(gateway(fetchImpl).pastActivity(PROJECT, SINCE)).rejects.toThrow(
      UpstreamFailedError,
    )
  })

  it('reaches GraphQL beside REST on an Enterprise Server', () => {
    expect(graphqlBaseOf(undefined)).toBe('https://api.github.com')
    expect(graphqlBaseOf('')).toBe('https://api.github.com')
    expect(graphqlBaseOf('https://ghe.example.com/api/v3/')).toBe('https://ghe.example.com/api')
  })
})
