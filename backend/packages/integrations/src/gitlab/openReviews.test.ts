import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { GitLabVcsGateway } from './GitLabVcsGateway.js'

const PROJECT = { provider: 'gitlab' as const, owner: 'platform/backend', repo: 'api' }

function openMerge(
  iid: string,
  author: string | null,
  approvers: string[] | null,
  options: { bots?: string[]; reviewers?: Record<string, string | null> } = {},
) {
  const approver = (username: string) => ({
    username,
    bot: (options.bots ?? []).includes(username),
  })
  const reviewer = ([username, reviewState]: [string, string | null]) => ({
    username,
    mergeRequestInteraction: reviewState === null ? null : { reviewState },
  })
  return {
    iid,
    author: author === null ? null : { username: author },
    approvedBy: approvers === null ? null : { nodes: approvers.map(approver) },
    reviewers: { nodes: Object.entries(options.reviewers ?? {}).map(reviewer) },
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
      { number: 7, reviewerLogins: ['Bea', 'cid'], awaitingLogins: [] },
      { number: 8, reviewerLogins: [], awaitingLogins: [] },
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
      { number: 7, reviewerLogins: ['bea'], awaitingLogins: [] },
      { number: 3, reviewerLogins: [], awaitingLogins: [] },
    ])
    expect(calls.map((call) => call.body.variables)).toStrictEqual([
      { fullPath: 'platform/backend/api', after: null },
      { fullPath: 'platform/backend/api', after: 'cursor-1' },
    ])
  })

  it('leaves out the author and bots', async () => {
    const { fetchImpl } = answering(
      merges(openMerge('7', 'Ann', ['ann', 'project_9_bot', 'bea'], { bots: ['project_9_bot'] })),
    )
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    expect(await gateway.openPullRequestReviews(PROJECT)).toStrictEqual([
      { number: 7, reviewerLogins: ['bea'], awaitingLogins: [] },
    ])
  })

  it('waits on the listed reviewers who have not answered, not on the ones who approved', async () => {
    const reviewers = {
      ann: 'APPROVED',
      bea: 'UNREVIEWED',
      cid: 'REVIEW_STARTED',
      dan: 'REQUESTED_CHANGES',
      eve: 'UNAPPROVED',
      fay: null,
    }
    const { fetchImpl } = answering(merges(openMerge('7', 'zed', ['ann'], { reviewers })))
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    expect(await gateway.openPullRequestReviews(PROJECT)).toStrictEqual([
      { number: 7, reviewerLogins: ['ann'], awaitingLogins: ['bea', 'cid', 'eve', 'fay'] },
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
