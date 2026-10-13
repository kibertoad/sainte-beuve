import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { GitLabVcsGateway } from './GitLabVcsGateway.js'

const PROJECT = { provider: 'gitlab' as const, owner: 'platform/backend', repo: 'api' }
const SINCE = Date.parse('2026-06-01T00:00:00Z')

interface Opened {
  by?: string | null
  at?: string
  bot?: boolean
}

function merge(approvers: string[] | null, opened: Opened = {}) {
  const by = opened.by ?? null
  return {
    createdAt: opened.at ?? '2026-01-01T00:00:00Z',
    author: by === null ? null : { username: by, bot: opened.bot ?? false },
    approvedBy: approvers === null ? null : { nodes: approvers.map((username) => ({ username })) },
  }
}

function merges(...nodes: ReturnType<typeof merge>[]) {
  return { data: { project: { mergeRequests: { nodes } } } }
}

interface Recorded {
  url: string
  body: { variables: unknown }
}

function answering(payload: unknown): { fetchImpl: typeof globalThis.fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Recorded['body'] })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, calls }
}

describe('GitLabVcsGateway.pastActivity', () => {
  it('tallies the approvers of recently updated merge requests, in one GraphQL call', async () => {
    const { fetchImpl, calls } = answering(
      merges(merge(['ann', 'bea']), merge(['ann']), merge(null)),
    )
    const gateway = new GitLabVcsGateway({
      token: 'glpat-x',
      baseUrl: 'https://gitlab.example.com/',
      fetchImpl,
    })

    expect((await gateway.pastActivity(PROJECT, SINCE)).reviewers).toStrictEqual([
      { login: 'ann', reviews: 2 },
      { login: 'bea', reviews: 1 },
    ])
    expect(calls.map((call) => call.url)).toStrictEqual(['https://gitlab.example.com/api/graphql'])
    expect(calls[0]?.body.variables).toStrictEqual({
      fullPath: 'platform/backend/api',
      updatedAfter: '2026-06-01T00:00:00.000Z',
    })
  })

  it('tallies who opened the merge requests created in the window, folding case', async () => {
    const recent = '2026-07-01T00:00:00Z'
    const { fetchImpl } = answering(
      merges(
        merge([], { by: 'Dan', at: recent }),
        merge([], { by: 'dan', at: '2026-06-01T00:00:00Z' }),
        merge([], { by: 'eve', at: recent }),
        merge([], { by: 'old', at: '2026-05-31T23:59:59Z' }),
        merge([], { by: 'project_9_bot_ab12', at: recent, bot: true }),
        merge([], { by: null, at: recent }),
      ),
    )
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    expect((await gateway.pastActivity(PROJECT, SINCE)).authors).toStrictEqual([
      { login: 'Dan', pullRequests: 2 },
      { login: 'eve', pullRequests: 1 },
    ])
  })

  it('answers nobody for a project this token cannot see', async () => {
    const { fetchImpl } = answering({ data: { project: null } })
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    expect(await gateway.pastActivity(PROJECT, SINCE)).toStrictEqual({
      reviewers: [],
      authors: [],
    })
  })

  it('fails on a GraphQL refusal, which arrives with a 200', async () => {
    const { fetchImpl } = answering({ errors: [{ message: 'Field does not exist' }] })
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    await expect(gateway.pastActivity(PROJECT, SINCE)).rejects.toThrow(UpstreamFailedError)
  })
})
