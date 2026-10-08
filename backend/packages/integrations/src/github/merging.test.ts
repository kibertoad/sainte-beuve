import { ConflictError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { staticTokenSource } from './credentials.js'
import { GitHubVcsGateway } from './GitHubVcsGateway.js'
import { approvalOf, mergeabilityOf } from './merging.js'

const PR = { provider: 'github', owner: 'acme', repo: 'api', number: 7 } as const

interface Route {
  status?: number
  body: unknown
}

/** Answers by `METHOD path`, so concurrent reads need no order. */
function routed(routes: Record<string, Route>) {
  const calls: { key: string; body: unknown }[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url))
    const key = `${init?.method ?? 'GET'} ${parsed.pathname}`
    calls.push({ key, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
    const route = routes[key]
    if (route === undefined) return new Response('{"message":"Not Found"}', { status: 404 })
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return {
    gateway: new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl }),
    calls,
  }
}

const OPEN_PULL = {
  state: 'open',
  html_url: 'https://github.com/acme/api/pull/7',
  draft: false,
  user: { login: 'ada' },
  mergeable: true,
  mergeable_state: 'clean',
  head: { sha: 'abc123' },
}

describe('approvalOf', () => {
  it('counts each reviewer by their latest verdict', () => {
    expect(
      approvalOf([
        { user: { login: 'bob' }, state: 'CHANGES_REQUESTED' },
        { user: { login: 'bob' }, state: 'COMMENTED' },
        { user: { login: 'bob' }, state: 'APPROVED' },
      ]),
    ).toBe('approved')
  })

  it('holds a change request over somebody else approving', () => {
    expect(
      approvalOf([
        { user: { login: 'bob' }, state: 'APPROVED' },
        { user: { login: 'eve' }, state: 'CHANGES_REQUESTED' },
      ]),
    ).toBe('changes_requested')
  })

  it('forgets a dismissed approval', () => {
    expect(
      approvalOf([
        { user: { login: 'bob' }, state: 'APPROVED' },
        { user: { login: 'bob' }, state: 'DISMISSED' },
      ]),
    ).toBe('pending')
  })
})

describe('mergeabilityOf', () => {
  it('maps the merge states GitHub reports', () => {
    const of = (mergeable_state: string, mergeable: boolean | null = true) =>
      mergeabilityOf({
        state: 'open',
        html_url: '',
        head: { sha: 'x' },
        mergeable,
        mergeable_state,
      })
    expect(of('clean')).toBe('mergeable')
    expect(of('unstable')).toBe('mergeable')
    expect(of('has_hooks')).toBe('mergeable')
    expect(of('blocked')).toBe('blocked')
    expect(of('behind')).toBe('blocked')
    expect(of('dirty', false)).toBe('conflicting')
    expect(of('unknown', null)).toBe('checking')
    expect(of('draft')).toBe('draft')
  })
})

describe('GitHubVcsGateway merging', () => {
  it('reads the status from the pull request and its reviews', async () => {
    const { gateway } = routed({
      'GET /repos/acme/api/pulls/7': { body: OPEN_PULL },
      'GET /repos/acme/api/pulls/7/reviews': {
        body: [{ user: { login: 'bob' }, state: 'APPROVED' }],
      },
    })
    expect(await gateway.pullRequestStatus(PR)).toStrictEqual({
      state: 'open',
      url: 'https://github.com/acme/api/pull/7',
      authorLogin: 'ada',
      draft: false,
      approval: 'approved',
      mergeability: 'mergeable',
      headSha: 'abc123',
    })
  })

  it('reads a merged pull request as merged rather than closed', async () => {
    const { gateway } = routed({
      'GET /repos/acme/api/pulls/7': { body: { ...OPEN_PULL, state: 'closed', merged: true } },
      'GET /repos/acme/api/pulls/7/reviews': { body: [] },
    })
    expect((await gateway.pullRequestStatus(PR)).state).toBe('merged')
  })

  it('merges at the expected head with the first method the repository allows', async () => {
    const { gateway, calls } = routed({
      'GET /repos/acme/api': { body: { allow_merge_commit: false, allow_squash_merge: true } },
      'PUT /repos/acme/api/pulls/7/merge': { body: { merged: true } },
    })
    await gateway.merge(PR, 'abc123')
    expect(calls.at(-1)).toStrictEqual({
      key: 'PUT /repos/acme/api/pulls/7/merge',
      body: { sha: 'abc123', merge_method: 'squash' },
    })
  })

  it('reports a merge GitHub refuses as a conflict, with its reason', async () => {
    const { gateway } = routed({
      'GET /repos/acme/api': { body: {} },
      'PUT /repos/acme/api/pulls/7/merge': {
        status: 409,
        body: { message: 'Head branch was modified. Review and try the merge again.' },
      },
    })
    const refusal = gateway.merge(PR, 'stale')
    await expect(refusal).rejects.toBeInstanceOf(ConflictError)
    await expect(refusal).rejects.toThrow('Head branch was modified')
  })
})
