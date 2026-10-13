import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { GitLabVcsGateway } from './GitLabVcsGateway.js'

const PROJECT = { provider: 'gitlab' as const, owner: 'platform/backend', repo: 'api' }

function openMerge(
  iid: string,
  author: string | null,
  approvers: string[] | null,
  bots: string[] = [],
) {
  const approver = (username: string) => ({ username, bot: bots.includes(username) })
  return {
    iid,
    author: author === null ? null : { username: author },
    approvedBy: approvers === null ? null : { nodes: approvers.map(approver) },
  }
}

function merges(...nodes: ReturnType<typeof openMerge>[]) {
  return page(null, nodes)
}

function page(endCursor: string | null, nodes: ReturnType<typeof openMerge>[]) {
  const pageInfo = { hasNextPage: endCursor !== null, endCursor }
  return { data: { project: { mergeRequests: { pageInfo, nodes } } } }
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
    expect(calls[0]?.body.variables).toStrictEqual({
      fullPath: 'platform/backend/api',
      after: null,
    })
    expect(calls[0]?.body.query).toContain('state: opened')
  })

  it('follows the pages past the first hundred', async () => {
    const { fetchImpl, calls } = answering(
      page('cursor-1', [openMerge('7', 'ann', ['bea'])]),
      page(null, [openMerge('3', 'ann', [])]),
    )
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    expect(await gateway.openPullRequestReviews(PROJECT)).toStrictEqual([
      { number: 7, reviewerLogins: ['bea'] },
      { number: 3, reviewerLogins: [] },
    ])
    expect(calls.map((call) => call.body.variables)).toStrictEqual([
      { fullPath: 'platform/backend/api', after: null },
      { fullPath: 'platform/backend/api', after: 'cursor-1' },
    ])
  })

  it('leaves out the author and bots', async () => {
    const { fetchImpl } = answering(
      merges(openMerge('7', 'Ann', ['ann', 'project_9_bot', 'bea'], ['project_9_bot'])),
    )
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
