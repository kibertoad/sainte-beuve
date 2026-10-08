import { ConflictError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { GitLabVcsGateway } from './GitLabVcsGateway.js'
import { approvalOf, mergeabilityOf } from './merging.js'

const MR = { provider: 'gitlab', owner: 'platform/backend', repo: 'api', number: 12 } as const
const BASE = '/api/v4/projects/platform%2Fbackend%2Fapi/merge_requests/12'

interface Route {
  status?: number
  body: unknown
}

/** Answers by `METHOD path`, so concurrent reads need no order. */
function routed(routes: Record<string, Route>) {
  const calls: { key: string; body: unknown }[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    // The raw path, because the project segment is percent-encoded on purpose.
    const path = String(url).replace(/^https:\/\/gitlab\.com/, '')
    const key = `${init?.method ?? 'GET'} ${path}`
    calls.push({ key, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
    const route = routes[key]
    if (route === undefined) return new Response('{"message":"404 Not found"}', { status: 404 })
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { gateway: new GitLabVcsGateway({ token: 'glpat', fetchImpl }), calls }
}

const OPEN_MR = {
  state: 'opened',
  web_url: 'https://gitlab.com/platform/backend/api/-/merge_requests/12',
  sha: 'def456',
  draft: false,
  author: { username: 'ada' },
  detailed_merge_status: 'mergeable',
}

describe('approvalOf', () => {
  it('needs an approver, because `approved` alone is true where none is required', () => {
    expect(approvalOf({ approved: true, approved_by: [] })).toBe('pending')
    expect(approvalOf({ approved: true, approved_by: [{ user: { username: 'bob' } }] })).toBe(
      'approved',
    )
    expect(approvalOf({ approved: false, approved_by: [{ user: { username: 'bob' } }] })).toBe(
      'pending',
    )
  })
})

describe('mergeabilityOf', () => {
  it('maps the detailed merge status', () => {
    const of = (detailed_merge_status: string) =>
      mergeabilityOf({ state: 'opened', web_url: '', sha: 'x', detailed_merge_status })
    expect(of('mergeable')).toBe('mergeable')
    expect(of('conflict')).toBe('conflicting')
    expect(of('draft_status')).toBe('draft')
    expect(of('checking')).toBe('checking')
    expect(of('not_approved')).toBe('blocked')
    expect(of('ci_must_pass')).toBe('blocked')
  })

  it('falls back to the coarse status on an older install', () => {
    const of = (merge_status: string) =>
      mergeabilityOf({ state: 'opened', web_url: '', sha: 'x', merge_status })
    expect(of('can_be_merged')).toBe('mergeable')
    expect(of('cannot_be_merged')).toBe('conflicting')
    expect(of('unchecked')).toBe('checking')
  })
})

describe('GitLabVcsGateway merging', () => {
  it('reads the status from the merge request and its approvals', async () => {
    const { gateway } = routed({
      [`GET ${BASE}`]: { body: OPEN_MR },
      [`GET ${BASE}/approvals`]: { body: { approved: false, approved_by: [] } },
    })
    expect(await gateway.pullRequestStatus(MR)).toStrictEqual({
      state: 'open',
      url: 'https://gitlab.com/platform/backend/api/-/merge_requests/12',
      authorLogin: 'ada',
      draft: false,
      approval: 'pending',
      mergeability: 'mergeable',
      headSha: 'def456',
    })
  })

  it('merges at the expected head and keeps the squash the author chose', async () => {
    const { gateway, calls } = routed({
      [`GET ${BASE}`]: { body: { ...OPEN_MR, squash: true } },
      [`PUT ${BASE}/merge`]: { body: { state: 'merged' } },
    })
    await gateway.merge(MR, 'def456')
    expect(calls.at(-1)).toStrictEqual({
      key: `PUT ${BASE}/merge`,
      body: { sha: 'def456', squash: true },
    })
  })

  it('reports a merge GitLab refuses as a conflict', async () => {
    const { gateway } = routed({
      [`GET ${BASE}`]: { body: OPEN_MR },
      [`PUT ${BASE}/merge`]: { status: 409, body: { message: 'SHA does not match HEAD' } },
    })
    await expect(gateway.merge(MR, 'stale')).rejects.toBeInstanceOf(ConflictError)
  })
})
