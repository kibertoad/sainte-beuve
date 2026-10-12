import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { GitLabVcsGateway } from './GitLabVcsGateway.js'

const PROJECT = { provider: 'gitlab' as const, owner: 'platform/backend', repo: 'api' }
const SINCE = Date.parse('2026-06-01T00:00:00Z')

function approvedBy(...usernames: string[]) {
  return { approvedBy: { nodes: usernames.map((username) => ({ username })) } }
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

describe('GitLabVcsGateway.pastReviewers', () => {
  it('tallies the approvers of recently updated merge requests, in one GraphQL call', async () => {
    const { fetchImpl, calls } = answering({
      data: {
        project: {
          mergeRequests: {
            nodes: [approvedBy('ann', 'bea'), approvedBy('ann'), { approvedBy: null }],
          },
        },
      },
    })
    const gateway = new GitLabVcsGateway({
      token: 'glpat-x',
      baseUrl: 'https://gitlab.example.com/',
      fetchImpl,
    })

    expect(await gateway.pastReviewers(PROJECT, SINCE)).toStrictEqual([
      { login: 'ann', reviews: 2 },
      { login: 'bea', reviews: 1 },
    ])
    expect(calls.map((call) => call.url)).toStrictEqual(['https://gitlab.example.com/api/graphql'])
    expect(calls[0]?.body.variables).toStrictEqual({
      fullPath: 'platform/backend/api',
      updatedAfter: '2026-06-01T00:00:00.000Z',
    })
  })

  it('answers nobody for a project this token cannot see', async () => {
    const { fetchImpl } = answering({ data: { project: null } })
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    expect(await gateway.pastReviewers(PROJECT, SINCE)).toStrictEqual([])
  })

  it('fails on a GraphQL refusal, which arrives with a 200', async () => {
    const { fetchImpl } = answering({ errors: [{ message: 'Field does not exist' }] })
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    await expect(gateway.pastReviewers(PROJECT, SINCE)).rejects.toThrow(UpstreamFailedError)
  })
})
