import { describe, expect, it } from 'vitest'
import { staticTokenSource } from './github/credentials.js'
import { GitHubVcsGateway } from './github/GitHubVcsGateway.js'
import { MAX_PAGES } from './github/client.js'
import { GitLabVcsGateway } from './gitlab/GitLabVcsGateway.js'

const at = (iso: string) => Date.parse(iso)
const SINCE = at('2026-10-01T00:00:00Z')

interface Recorded {
  body: { query: string; variables: Record<string, unknown> }
}

function answering(...payloads: unknown[]) {
  const calls: Recorded[] = []
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) as Recorded['body'] })
    const payload = payloads[Math.min(calls.length, payloads.length) - 1]
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, calls }
}

function githubPull(number: number, createdAt: string, extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/api/pull/${number}`,
    isDraft: false,
    createdAt,
    mergedAt: null,
    closedAt: null,
    author: { __typename: 'User', login: 'bob' },
    reviews: { nodes: [] },
    timelineItems: { nodes: [] },
    dismissals: { nodes: [] },
    ...extra,
  }
}

function githubPage(endCursor: string | null, nodes: unknown[]) {
  const pageInfo = { hasNextPage: endCursor !== null, endCursor }
  return { data: { repository: { pullRequests: { pageInfo, nodes } } } }
}

describe('GitHubVcsGateway.reviewTimelines', () => {
  const PROJECT = { provider: 'github' as const, owner: 'acme', repo: 'api' }
  const gateway = (fetchImpl: typeof globalThis.fetch) =>
    new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

  it('reads reviews, readiness and merges, and stops at the page that reaches past the window', async () => {
    const { fetchImpl, calls } = answering(
      githubPage('c1', [
        githubPull(9, '2026-10-10T00:00:00Z', {
          mergedAt: '2026-10-11T00:00:00Z',
          closedAt: '2026-10-11T00:00:00Z',
          timelineItems: { nodes: [{ createdAt: '2026-10-10T06:00:00Z' }] },
          reviews: {
            nodes: [
              {
                state: 'COMMENTED',
                submittedAt: '2026-10-10T07:00:00Z',
                author: { __typename: 'Bot', login: 'coderabbitai' },
              },
              {
                state: 'APPROVED',
                submittedAt: '2026-10-10T09:00:00Z',
                author: { __typename: 'User', login: 'ada' },
              },
            ],
          },
        }),
      ]),
      githubPage('c2', [
        githubPull(8, '2026-10-02T00:00:00Z'),
        githubPull(7, '2026-09-20T00:00:00Z'),
      ]),
    )

    const { pullRequests, truncated } = await gateway(fetchImpl).reviewTimelines(PROJECT, SINCE)

    expect(truncated).toBe(false)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.body.variables).toStrictEqual({ owner: 'acme', name: 'api', after: 'c1' })
    expect(pullRequests.map((pr) => pr.number)).toEqual([9, 8])
    expect(pullRequests[0]).toMatchObject({
      readyAt: at('2026-10-10T06:00:00Z'),
      mergedAt: at('2026-10-11T00:00:00Z'),
      reviews: [
        { login: 'coderabbitai', bot: true, kind: 'commented', at: at('2026-10-10T07:00:00Z') },
        { login: 'ada', bot: false, kind: 'approved', at: at('2026-10-10T09:00:00Z') },
      ],
    })
    expect(pullRequests[1]?.readyAt).toBe(at('2026-10-02T00:00:00Z'))
  })

  it('counts a dismissed review as what it was before the dismissal', async () => {
    const { fetchImpl } = answering(
      githubPage(null, [
        githubPull(3, '2026-10-05T00:00:00Z', {
          reviews: {
            nodes: [
              {
                id: 'r1',
                state: 'DISMISSED',
                submittedAt: '2026-10-05T02:00:00Z',
                author: { __typename: 'User', login: 'ada' },
              },
              {
                id: 'r2',
                state: 'DISMISSED',
                submittedAt: '2026-10-05T03:00:00Z',
                author: { __typename: 'User', login: 'carol' },
              },
            ],
          },
          dismissals: {
            nodes: [
              { previousReviewState: 'APPROVED', review: { id: 'r1' } },
              { previousReviewState: 'CHANGES_REQUESTED', review: { id: 'r2' } },
            ],
          },
        }),
      ]),
    )
    const { pullRequests } = await gateway(fetchImpl).reviewTimelines(PROJECT, SINCE)
    expect(pullRequests[0]?.reviews.map((review) => [review.login, review.kind])).toEqual([
      ['ada', 'approved'],
      ['carol', 'changes_requested'],
    ])
  })

  it('fails a repository the credential cannot see instead of reading it as empty', async () => {
    const { fetchImpl } = answering({ data: { repository: null } })
    await expect(gateway(fetchImpl).reviewTimelines(PROJECT, SINCE)).rejects.toThrow(/acme\/api/)
  })

  it('reports a read that ran out of pages inside the window as truncated', async () => {
    const { fetchImpl, calls } = answering(
      githubPage('next', [githubPull(5, '2026-10-12T00:00:00Z')]),
    )
    const { truncated } = await gateway(fetchImpl).reviewTimelines(PROJECT, SINCE)
    expect(truncated).toBe(true)
    expect(calls).toHaveLength(MAX_PAGES)
  })
})

function gitlabMerge(iid: number, notes: unknown[], extra: Record<string, unknown> = {}) {
  return {
    iid: String(iid),
    title: `Change ${iid}`,
    webUrl: `https://gitlab.com/acme/api/-/merge_requests/${iid}`,
    draft: false,
    createdAt: '2026-10-05T00:00:00Z',
    mergedAt: null,
    closedAt: null,
    author: { username: 'bob', bot: false },
    notes: { nodes: notes },
    ...extra,
  }
}

function note(
  body: string,
  createdAt: string,
  author: { username: string; system?: boolean; bot?: boolean },
) {
  const { username, system = false, bot = false } = author
  return { body, createdAt, system, author: { username, bot } }
}

describe('GitLabVcsGateway.reviewTimelines', () => {
  const PROJECT = { provider: 'gitlab' as const, owner: 'acme', repo: 'api' }

  it('reads comments as reviews and approvals and readiness from system notes', async () => {
    const { fetchImpl, calls } = answering({
      data: {
        project: {
          mergeRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              gitlabMerge(
                4,
                [
                  note('marked this merge request as **ready**', '2026-10-05T02:00:00Z', {
                    username: 'bob',
                    system: true,
                  }),
                  note('Looks fine', '2026-10-05T03:00:00Z', { username: 'review-bot', bot: true }),
                  note('approved this merge request', '2026-10-05T05:00:00Z', {
                    username: 'ada',
                    system: true,
                  }),
                  note('added 1 commit', '2026-10-05T06:00:00Z', { username: 'bob', system: true }),
                ],
                { mergedAt: '2026-10-06T00:00:00Z' },
              ),
            ],
          },
        },
      },
    })

    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    const { pullRequests, truncated } = await gateway.reviewTimelines(PROJECT, SINCE)

    expect(truncated).toBe(false)
    expect(calls[0]?.body.variables).toMatchObject({
      fullPath: 'acme/api',
      createdAfter: '2026-10-01T00:00:00.000Z',
    })
    expect(pullRequests).toStrictEqual([
      {
        number: 4,
        title: 'Change 4',
        url: 'https://gitlab.com/acme/api/-/merge_requests/4',
        authorLogin: 'bob',
        authorBot: false,
        draft: false,
        createdAt: at('2026-10-05T00:00:00Z'),
        readyAt: at('2026-10-05T02:00:00Z'),
        mergedAt: at('2026-10-06T00:00:00Z'),
        closedAt: at('2026-10-06T00:00:00Z'),
        reviews: [
          { login: 'review-bot', bot: true, kind: 'commented', at: at('2026-10-05T03:00:00Z') },
          { login: 'ada', bot: false, kind: 'approved', at: at('2026-10-05T05:00:00Z') },
        ],
      },
    ])
  })

  it('fails a project the credential cannot see instead of reading it as empty', async () => {
    const { fetchImpl } = answering({ data: { project: null } })
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })
    await expect(gateway.reviewTimelines(PROJECT, SINCE)).rejects.toThrow(/acme\/api/)
  })
})
