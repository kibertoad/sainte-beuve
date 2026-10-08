import type {
  GuidedReviewMessage,
  GuidedReviewSession,
  GuidedReviewSessionView,
} from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  anchorHref,
  anchorLabel,
  FAST_POLL_MS,
  guidedReviewRoute,
  isPostable,
  isSessionWorking,
  prUrlFromQuery,
  refusalMessage,
  sessionPollInterval,
  SLOW_POLL_MS,
  targetFromQuery,
  threadPollInterval,
} from '../app/utils/guidedReview'
import { ApiError } from '../app/utils/sainteBeuveApi'

function session(overrides: Partial<GuidedReviewSession> = {}): GuidedReviewSession {
  return {
    id: 'grs-1',
    provider: 'github',
    repoId: 'repo-1',
    owner: 'kibertoad',
    repo: 'sainte-beuve',
    prNumber: 7,
    prTitle: 'Add a widget',
    reviewedHeadSha: 'abc123',
    baseRef: 'main',
    createdBy: 'key-1',
    createdByKind: 'api-key',
    overview: { status: 'complete', generation: 1, content: null, failure: null, model: null },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const PR_URL = 'https://github.com/kibertoad/sainte-beuve/pull/7'

describe('the guided review route', () => {
  it('round-trips a pull request through its query', () => {
    const { query } = guidedReviewRoute({
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 7,
      url: PR_URL,
    })

    expect(targetFromQuery(query)).toStrictEqual({
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 7,
    })
    expect(prUrlFromQuery(query)).toBe(PR_URL)
  })

  it('names no pull request for a query that does not', () => {
    expect(targetFromQuery({ provider: 'github', owner: 'kibertoad', repo: 'x' })).toBeNull()
    expect(targetFromQuery({ provider: 'svn', owner: 'a', repo: 'b', number: '1' })).toBeNull()
  })

  it('carries no link a script could ride in on', () => {
    expect(prUrlFromQuery({ url: 'javascript:alert(1)' })).toBeNull()
  })
})

describe('isSessionWorking', () => {
  const view = (overrides: Partial<GuidedReviewSessionView> = {}): GuidedReviewSessionView => ({
    session: session(),
    threads: [],
    drafts: [],
    ...overrides,
  })

  it('is working while the overview is generated', () => {
    const pending = session({
      overview: { status: 'running', generation: 1, content: null, failure: null, model: null },
    })
    expect(isSessionWorking(view({ session: pending }))).toBe(true)
  })

  it('is working while any thread waits on an answer, and settled otherwise', () => {
    const thread = {
      id: 'thr-1',
      sessionId: 'grs-1',
      title: 'Why',
      createdBy: 'key-1',
      createdAt: 1,
      updatedAt: 1,
    }
    expect(isSessionWorking(view({ threads: [{ ...thread, pendingMessageId: 'msg-2' }] }))).toBe(
      true,
    )
    expect(isSessionWorking(view({ threads: [{ ...thread, pendingMessageId: null }] }))).toBe(false)
  })
})

describe('anchors', () => {
  it('names a span the way a reviewer would', () => {
    expect(anchorLabel({ path: 'src/a.ts' })).toBe('src/a.ts')
    expect(anchorLabel({ path: 'src/a.ts', startLine: 4 })).toBe('src/a.ts:4')
    expect(anchorLabel({ path: 'src/a.ts', startLine: 4, endLine: 9 })).toBe('src/a.ts:4-9')
  })

  it('links a GitHub span at the commit the review read', () => {
    expect(anchorHref(session(), { path: 'src/a b.ts', startLine: 4, endLine: 9 }, PR_URL)).toBe(
      'https://github.com/kibertoad/sainte-beuve/blob/abc123/src/a%20b.ts#L4-L9',
    )
  })

  it('links a base-side span at the base branch', () => {
    expect(anchorHref(session(), { path: 'a.ts', startLine: 2, side: 'LEFT' }, PR_URL)).toBe(
      'https://github.com/kibertoad/sainte-beuve/blob/main/a.ts#L2',
    )
  })

  it('links a GitLab span on the host the pull request is on', () => {
    const gitlab = session({ provider: 'gitlab', owner: 'group', repo: 'app' })
    expect(
      anchorHref(gitlab, { path: 'a.ts', startLine: 2, endLine: 3 }, 'https://git.acme.dev/x'),
    ).toBe('https://git.acme.dev/group/app/-/blob/abc123/a.ts#L2-3')
  })

  it('links nowhere without the pull request to take a host from', () => {
    expect(anchorHref(session(), { path: 'a.ts' }, null)).toBeNull()
  })
})

describe('refusalMessage', () => {
  it('says what to do about a refusal cat-factory named', () => {
    const stale = new ApiError(409, 'conflict', 'cat-factory would not post', {
      upstream: 'cat-factory',
      reason: 'session_stale',
    })
    expect(refusalMessage(stale)).toMatch(/Re-read it at the latest commit/)
  })

  it("falls back to the API's own message for a reason it has no advice for", () => {
    const other = new ApiError(502, 'upstream_failed', 'cat-factory could not post', {
      upstream: 'cat-factory',
      reason: 'internal',
    })
    expect(refusalMessage(other)).toBe('cat-factory could not post')
  })
})

describe('isPostable', () => {
  it('offers a proposed draft and a failed one, and nothing that is settled or in flight', () => {
    const statuses = ['proposed', 'failed', 'posting', 'posted', 'discarded'] as const
    const postable = statuses.filter((status) =>
      isPostable({
        id: 'drf-1',
        sessionId: 'grs-1',
        threadId: 'thr-1',
        messageId: 'msg-1',
        path: 'a.ts',
        line: 1,
        startLine: null,
        side: 'RIGHT',
        body: 'x',
        rationale: '',
        status,
        postError: null,
        postedUrl: null,
        rev: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    )
    expect(postable).toStrictEqual(['proposed', 'failed'])
  })
})

describe('poll cadence', () => {
  function message(overrides: Partial<GuidedReviewMessage>): GuidedReviewMessage {
    return {
      id: 'msg-2',
      threadId: 'thr-1',
      sessionId: 'grs-1',
      seq: 2,
      role: 'assistant',
      kind: 'answer',
      depth: 'inline',
      content: '',
      status: 'running',
      citations: [],
      failure: null,
      draftReport: null,
      model: null,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    }
  }

  it('waits on a deep answer slowly, because it takes minutes', () => {
    expect(threadPollInterval([message({ depth: 'deep' })])).toBe(SLOW_POLL_MS)
    expect(threadPollInterval([message({ depth: 'inline' })])).toBe(FAST_POLL_MS)
    expect(threadPollInterval([message({ depth: 'deep', status: 'complete' })])).toBe(FAST_POLL_MS)
  })

  it('reads a session fast only while its overview is generated', () => {
    const view = (status: GuidedReviewSession['overview']['status']): GuidedReviewSessionView => ({
      session: session({
        overview: { status, generation: 1, content: null, failure: null, model: null },
      }),
      threads: [],
      drafts: [],
    })
    expect(sessionPollInterval(view('running'))).toBe(FAST_POLL_MS)
    expect(sessionPollInterval(view('complete'))).toBe(SLOW_POLL_MS)
  })
})
