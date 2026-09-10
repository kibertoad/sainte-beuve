import type { ProjectRef, PullRequestRef } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { GitLabVcsGateway } from './GitLabVcsGateway.js'

// The wire shape of the GitLab half of the port. Worth pinning because almost
// none of it looks like GitHub's: a project is one URL-encoded segment, a merge
// request is addressed by `iid`, and reviewers are numeric ids that have to be
// looked up and merged rather than added.

const PROJECT: ProjectRef = { provider: 'gitlab', owner: 'platform/backend', repo: 'api' }

const MR: PullRequestRef = {
  provider: 'gitlab',
  owner: 'platform/backend',
  repo: 'api',
  number: 12,
  url: 'https://gitlab.com/platform/backend/api/-/merge_requests/12',
}

interface Recorded {
  method: string
  url: string
  authorization: string
  body: unknown
}

/** Answers each call from a queue, so a multi-step write can be scripted. */
function stub(payloads: unknown[]): { fetchImpl: typeof globalThis.fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  const queue = [...payloads]
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      authorization: headers.authorization ?? '',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    return new Response(JSON.stringify(queue.shift() ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, calls }
}

describe('GitLabVcsGateway', () => {
  it('lists open merge requests as pull requests, with the author and reviewers', async () => {
    const { fetchImpl, calls } = stub([
      [
        {
          iid: 12,
          title: 'Add a health check',
          web_url: 'https://gitlab.com/platform/backend/api/-/merge_requests/12',
          draft: true,
          created_at: '2026-09-01T10:00:00Z',
          updated_at: '2026-09-02T10:00:00Z',
          author: { id: 1, username: 'author' },
          reviewers: [{ id: 2, username: 'peer' }],
        },
      ],
    ])
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    const listed = await gateway.listOpenPullRequests(PROJECT)

    // A nested namespace is one URL-encoded segment, which is why nothing above
    // the adapter has to know that GitLab groups can nest.
    expect(calls[0]?.url).toContain('/api/v4/projects/platform%2Fbackend%2Fapi/merge_requests')
    expect(calls[0]?.authorization).toBe('Bearer glpat_x')
    expect(listed).toStrictEqual([
      {
        pullRequest: { ...MR, provider: 'gitlab' },
        title: 'Add a health check',
        authorLogin: 'author',
        requestedReviewerLogins: ['peer'],
        draft: true,
        createdAt: Date.parse('2026-09-01T10:00:00Z'),
        updatedAt: Date.parse('2026-09-02T10:00:00Z'),
      },
    ])
  })

  it('reads `work_in_progress` on an install too old to answer `draft`', async () => {
    const { fetchImpl } = stub([
      [
        {
          iid: 12,
          title: 'Older install',
          web_url: MR.url,
          work_in_progress: true,
          created_at: '2026-09-01T10:00:00Z',
          updated_at: '2026-09-01T10:00:00Z',
          author: { id: 1, username: 'author' },
        },
      ],
    ])
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    expect((await gateway.listOpenPullRequests(PROJECT))[0]?.draft).toBe(true)
  })

  it('adds a reviewer without dropping the ones already on the merge request', async () => {
    const { fetchImpl, calls } = stub([
      { iid: 12, reviewers: [{ id: 2, username: 'peer' }] },
      [{ id: 3, username: 'alice' }],
      {},
    ])
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    await gateway.requestReviewers(MR, ['alice'])

    // The update REPLACES the list, so a write that named only the newcomer
    // would quietly un-request everybody already on it.
    expect(calls[2]).toMatchObject({ method: 'PUT', body: { reviewer_ids: [2, 3] } })
  })

  it('takes a reviewer off and leaves the rest', async () => {
    const { fetchImpl, calls } = stub([
      {
        iid: 12,
        reviewers: [
          { id: 2, username: 'peer' },
          { id: 3, username: 'alice' },
        ],
      },
      [{ id: 3, username: 'alice' }],
      {},
    ])
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    await gateway.removeRequestedReviewers(MR, ['alice'])

    expect(calls[2]).toMatchObject({ method: 'PUT', body: { reviewer_ids: [2] } })
  })

  it('writes nothing when the reviewer is already requested', async () => {
    const { fetchImpl, calls } = stub([
      { iid: 12, reviewers: [{ id: 3, username: 'alice' }] },
      [{ id: 3, username: 'alice' }],
    ])
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    await gateway.requestReviewers(MR, ['alice'])

    expect(calls.map((call) => call.method)).toStrictEqual(['GET', 'GET'])
  })

  it('skips a reviewer this install has never heard of', async () => {
    const { fetchImpl, calls } = stub([{ iid: 12, reviewers: [] }, [], {}])
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    // A reviewer in our directory with no account here must not stop the
    // request; there is simply nobody to put on it.
    await gateway.requestReviewers(MR, ['ghost'])

    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('comments as a merge-request note', async () => {
    const { fetchImpl, calls } = stub([{}])
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    await gateway.comment(MR, 'Review requested from Alice.')

    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { body: 'Review requested from Alice.' },
    })
    expect(calls[0]?.url).toContain('/merge_requests/12/notes')
  })

  it('reads the account behind the credential and memoises it', async () => {
    const { fetchImpl, calls } = stub([{ id: 77, username: 'igor.savin', name: 'Igor' }])
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    expect(await gateway.identify()).toStrictEqual({
      subject: '77',
      username: 'igor.savin',
      displayName: 'Igor',
      avatarUrl: null,
    })
    await gateway.identify()
    expect(calls).toHaveLength(1)
  })

  it('reaches a self-managed install at its own root', async () => {
    const { fetchImpl, calls } = stub([{ id: 1, username: 'someone' }])
    const gateway = new GitLabVcsGateway({
      token: 'glpat_x',
      baseUrl: 'https://gitlab.example.com/',
      fetchImpl,
    })

    await gateway.identify()

    expect(calls[0]?.url).toBe('https://gitlab.example.com/api/v4/user')
  })

  it('carries GitLab own refusal, so a missing scope is named', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: '403 Forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch
    const gateway = new GitLabVcsGateway({ token: 'glpat_x', fetchImpl })

    await expect(gateway.listOpenPullRequests(PROJECT)).rejects.toThrow(/403 .*403 Forbidden/)
  })
})
