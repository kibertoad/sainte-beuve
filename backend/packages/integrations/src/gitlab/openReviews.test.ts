import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { GitLabVcsGateway } from './GitLabVcsGateway.js'

const PROJECT = { provider: 'gitlab' as const, owner: 'platform/backend', repo: 'api' }

function openMerge(iid: string, author: string | null, approvers: string[] | null) {
  return {
    iid,
    author: author === null ? null : { username: author },
    approvedBy: approvers === null ? null : { nodes: approvers.map((username) => ({ username })) },
  }
}

function merges(...nodes: ReturnType<typeof openMerge>[]) {
  return { data: { project: { mergeRequests: { nodes } } } }
}

interface Recorded {
  url: string
  body: { query: string; variables: unknown }
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

describe('GitLabVcsGateway.openPullRequestReviews', () => {
  it('lists who approved each open merge request once, in one GraphQL call', async () => {
    const { fetchImpl, calls } = answering(
      merges(openMerge('7', 'ann', ['Bea', 'bea', 'cid']), openMerge('8', 'bea', null)),
    )
    const gateway = new GitLabVcsGateway({
      token: 'glpat-x',
      baseUrl: 'https://gitlab.example.com/',
      fetchImpl,
    })

    expect(await gateway.openPullRequestReviews(PROJECT)).toStrictEqual([
      { number: 7, reviewerLogins: ['Bea', 'cid'] },
      { number: 8, reviewerLogins: [] },
    ])
    expect(calls.map((call) => call.url)).toStrictEqual(['https://gitlab.example.com/api/graphql'])
    expect(calls[0]?.body.variables).toStrictEqual({ fullPath: 'platform/backend/api' })
    expect(calls[0]?.body.query).toContain('state: opened')
  })

  it('leaves out the author', async () => {
    const { fetchImpl } = answering(merges(openMerge('7', 'Ann', ['ann', 'bea'])))
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    expect(await gateway.openPullRequestReviews(PROJECT)).toStrictEqual([
      { number: 7, reviewerLogins: ['bea'] },
    ])
  })

  it('answers nothing for a project this token cannot see', async () => {
    const { fetchImpl } = answering({ data: { project: null } })
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    expect(await gateway.openPullRequestReviews(PROJECT)).toStrictEqual([])
  })

  it('fails on a GraphQL refusal, which arrives with a 200', async () => {
    const { fetchImpl } = answering({ errors: [{ message: 'Field does not exist' }] })
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    await expect(gateway.openPullRequestReviews(PROJECT)).rejects.toThrow(UpstreamFailedError)
  })
})
