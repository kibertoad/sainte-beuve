import { describe, expect, it } from 'vitest'
import { CatFactoryAiReviewGateway } from './CatFactoryAiReviewGateway.js'

/**
 * The gateway is tested through the SDK's own `fetch` seam rather than by stubbing
 * the client: what these cases are about is the translation between a cat-factory
 * run and the AI-review port, and that translation only means anything on the wire
 * shape the SDK actually decodes.
 */
interface Call {
  method: string
  path: string
  body: unknown
}

/** One canned answer, keyed by the path suffix the SDK asks for. */
type Routes = Record<string, { status?: number; body: unknown }>

function gatewayOver(routes: Routes): {
  gateway: CatFactoryAiReviewGateway
  calls: Call[]
} {
  const calls: Call[] = []
  const gateway = new CatFactoryAiReviewGateway({
    baseUrl: 'https://cat-factory.example.com',
    apiKey: 'cf_live_key.secret',
    serviceId: 'svc-1',
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname
      const raw = init?.body
      calls.push({
        method: init?.method ?? 'GET',
        path,
        body: typeof raw === 'string' ? JSON.parse(raw) : null,
      })
      const route = Object.entries(routes).find(([suffix]) => path.endsWith(suffix))
      if (route === undefined) {
        return new Response(JSON.stringify({ error: { code: 'not_found', message: path } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(route[1].body), {
        status: route[1].status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { gateway, calls }
}

/** A gateway whose every call gets the same answer: `''` is a suffix of every path. */
function gatewayAnswering(status: number, body: unknown): CatFactoryAiReviewGateway {
  return gatewayOver({ '': { status, body } }).gateway
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    status: 'running',
    createdAt: 0,
    currentStep: 0,
    error: null,
    externalIdentity: null,
    externalIdentityWithheld: false,
    pullRequest: null,
    steps: [],
    ...overrides,
  }
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    serviceId: 'svc-1',
    title: 'Review kibertoad/sainte-beuve#7',
    status: 'planned',
    runId: null,
    progress: 0,
    prUrl: null,
    createdAt: 0,
    ...overrides,
  }
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    findingId: 'f-1',
    title: 'Unbounded retry',
    detail: 'The loop never gives up.',
    path: 'src/poll.ts',
    line: 42,
    side: 'RIGHT',
    severity: 'blocker',
    category: 'correctness',
    sliceId: 'slice-1',
    suggestedFix: null,
    challenge: null,
    ...overrides,
  }
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'pr-review',
    status: 'awaiting_selection',
    findings: [finding()],
    selectedFindingIds: [],
    postedFindingIds: [],
    postedBody: false,
    postAttempts: 0,
    postReport: null,
    prUrl: 'https://github.com/kibertoad/sainte-beuve/pull/7',
    slices: [
      { sliceId: 'slice-1', title: 'polling', paths: ['src/poll.ts'], rationale: 'the loop' },
    ],
    reportedSlices: 1,
    resumeAttempts: 0,
    maxResumeAttempts: 3,
    lastActivityAt: 1_700_000,
    summary: null,
    ...overrides,
  }
}

function decisions(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    status: 'blocked',
    parked: true,
    decisions: [decision()],
    unanswerable: [],
    ...overrides,
  }
}

/** One pull request to file a review of. Only the fields the brief is built from. */
const PULL_REQUEST = {
  provider: 'github' as const,
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 7,
  url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
}

function filing(gateway: CatFactoryAiReviewGateway) {
  return gateway.requestReview({
    pullRequest: PULL_REQUEST,
    title: 'Poll on the read',
    instructions: null,
  })
}

describe('CatFactoryAiReviewGateway.requestReview', () => {
  it('files the task and starts it, and reports the handle the loop is tracked by', async () => {
    const { gateway, calls } = gatewayOver({
      '/tasks': { body: task() },
      '/start': { body: task({ status: 'running' }) },
    })

    expect(await filing(gateway)).toStrictEqual({
      taskId: 'task-1',
      url: 'https://cat-factory.example.com/tasks/task-1',
    })
    expect(calls.map((call) => call.path)).toStrictEqual([
      '/api/v1/services/svc-1/tasks',
      '/api/v1/tasks/task-1/start',
    ])
  })

  /**
   * The refusal a deployment meets FIRST, and the one this translation exists
   * for: a review parks, so cat-factory will not start one on a key that could
   * not answer the decision. Reported as an upstream fault it would send an
   * operator to read cat-factory's logs about their own key.
   */
  it('names the scope when a key too low to drive a review is refused at filing', async () => {
    const { gateway } = gatewayOver({
      '/tasks': { body: task() },
      '/start': {
        status: 403,
        body: { error: { code: 'insufficient_scope', message: 'needs decide' } },
      },
    })

    await expect(filing(gateway)).rejects.toMatchObject({
      code: 'forbidden',
      message: /`decide` scope/,
    })
  })

  it('reports a revoked key as a refusal to fix here, not as a cat-factory fault', async () => {
    const { gateway } = gatewayOver({
      '/tasks': {
        status: 401,
        body: { error: { code: 'unauthorized', message: 'no such key' } },
      },
    })

    await expect(filing(gateway)).rejects.toMatchObject({
      code: 'forbidden',
      message: /Configuration screen/,
    })
  })

  /** The one refusal where making the same call again IS the answer. */
  it('reports a full cat-factory as unavailable rather than as a fault', async () => {
    const { gateway } = gatewayOver({
      '/tasks': {
        status: 429,
        body: { error: { code: 'too_many_active_runs', message: 'at capacity' } },
      },
    })

    await expect(filing(gateway)).rejects.toMatchObject({
      code: 'unavailable',
      message: /worth making again/,
    })
  })

  it('reports a cat-factory fault at filing as upstream', async () => {
    const gateway = gatewayAnswering(500, { error: { code: 'internal', message: 'boom' } })
    await expect(filing(gateway)).rejects.toMatchObject({ code: 'upstream_failed' })
  })
})

describe('CatFactoryAiReviewGateway.getStatus', () => {
  it('reports the verdict of a finished run as its summary', async () => {
    const gateway = gatewayAnswering(
      200,
      run({
        status: 'done',
        steps: [
          { agentKind: 'reader', output: 'read the diff', progress: 1, state: 'done' },
          { agentKind: 'reviewer', output: '  Two blocking findings.  ', progress: 1 },
        ],
      }),
    )

    expect(await gateway.getStatus('task-1')).toStrictEqual({
      status: 'completed',
      runId: 'run-1',
      summary: 'Two blocking findings.',
      failureReason: null,
      curation: null,
    })
  })

  it('asks a settled run for no decisions, because it has none left to give', async () => {
    const { gateway, calls } = gatewayOver({
      '/run': { body: run({ status: 'done', steps: [] }) },
    })
    await gateway.getStatus('task-1')
    expect(calls.map((call) => call.path)).toStrictEqual(['/api/v1/tasks/task-1/run'])
  })

  it('reports why a run failed without passing it off as a verdict', async () => {
    const gateway = gatewayAnswering(
      200,
      run({ status: 'failed', error: { code: 'model_error', message: 'the model timed out' } }),
    )
    const reported = await gateway.getStatus('task-1')
    expect(reported.status).toBe('failed')
    expect(reported.summary).toBeNull()
    expect(reported.failureReason).toBe('the model timed out')
  })

  it('reports a cancelled run as cancelled, so nothing polls it for ever', async () => {
    const gateway = gatewayAnswering(200, run({ status: 'cancelled' }))
    expect((await gateway.getStatus('task-1')).status).toBe('cancelled')
  })

  it('treats the first poll of a task with no run yet as running', async () => {
    const gateway = gatewayAnswering(404, { error: { code: 'not_found', message: 'no run' } })
    expect(await gateway.getStatus('task-1')).toStrictEqual({
      status: 'running',
      runId: null,
      summary: null,
      failureReason: null,
      curation: null,
    })
  })

  it('refuses upstream faults rather than reporting a verdict it does not have', async () => {
    const gateway = gatewayAnswering(500, { error: { code: 'internal', message: 'boom' } })
    await expect(gateway.getStatus('task-1')).rejects.toThrow(/could not report the run status/)
  })

  /**
   * The decision read is the second call of a poll, and a 404 on it is as
   * ordinary as a 404 on the first: cat-factory prunes decisions, a rotated key
   * sees a run outside its workspace. Raising it would fail every poll of a
   * review whose findings are sitting right there.
   */
  it('treats a run with no decisions left to read as carrying no curation', async () => {
    const { gateway } = gatewayOver({
      '/run': { body: run({ status: 'blocked' }) },
      '/decisions': { status: 404, body: { error: { code: 'not_found', message: 'no run' } } },
    })

    const reported = await gateway.getStatus('task-1')
    expect(reported.status).toBe('running')
    expect(reported.curation).toBeNull()
  })

  it('reports a fault on the decision read as upstream, not as an empty review', async () => {
    const { gateway } = gatewayOver({
      '/run': { body: run({ status: 'blocked' }) },
      '/decisions': { status: 500, body: { error: { code: 'internal', message: 'boom' } } },
    })
    await expect(gateway.getStatus('task-1')).rejects.toMatchObject({ code: 'upstream_failed' })
  })

  it('reports a review parked on its findings as awaiting a selection', async () => {
    const { gateway } = gatewayOver({
      '/run': { body: run({ status: 'blocked' }) },
      '/decisions': { body: decisions() },
    })

    const reported = await gateway.getStatus('task-1')
    expect(reported.status).toBe('awaiting_selection')
    expect(reported.runId).toBe('run-1')
    expect(reported.curation).toStrictEqual({
      status: 'awaiting_selection',
      findings: [
        {
          findingId: 'f-1',
          title: 'Unbounded retry',
          detail: 'The loop never gives up.',
          path: 'src/poll.ts',
          line: 42,
          side: 'RIGHT',
          severity: 'blocker',
          category: 'correctness',
          suggestedFix: null,
        },
      ],
      selectedFindingIds: [],
      postedFindingIds: [],
      postedBody: false,
      postAttempts: 0,
      postReport: null,
      sliceCount: 1,
      reportedSliceCount: 1,
      lastActivityAt: 1_700_000,
      resumeAttempts: 0,
      maxResumeAttempts: 3,
    })
  })

  /**
   * The whole reason the loop needs a receipt: a post that lands nothing re-parks
   * the review at `awaiting_selection` with the selection cleared, which is
   * byte-for-byte a review nobody has curated yet.
   */
  it('carries the post receipt back, so a pass that landed nothing is not read as uncurated', async () => {
    const { gateway } = gatewayOver({
      '/run': { body: run({ status: 'blocked' }) },
      '/decisions': {
        body: decisions({
          decisions: [
            decision({
              postAttempts: 2,
              postedFindingIds: ['f-9'],
              postedBody: true,
              postReport: {
                attempt: 2,
                attempted: 3,
                posted: 0,
                folded: 1,
                bodyPosted: null,
                bodyError: null,
                failures: [
                  { findingId: 'f-1', path: 'src/poll.ts', line: 42, reason: 'line not in diff' },
                ],
              },
            }),
          ],
        }),
      },
    })

    const reported = await gateway.getStatus('task-1')
    expect(reported.status).toBe('awaiting_selection')
    expect(reported.curation?.postAttempts).toBe(2)
    expect(reported.curation?.postedFindingIds).toStrictEqual(['f-9'])
    expect(reported.curation?.postedBody).toBe(true)
    expect(reported.curation?.postReport).toStrictEqual({
      attempt: 2,
      attempted: 3,
      posted: 0,
      folded: 1,
      bodyPosted: null,
      bodyError: null,
      failures: [{ findingId: 'f-1', path: 'src/poll.ts', line: 42, reason: 'line not in diff' }],
    })
  })

  it('treats a blocked run that is not awaiting a curator as still running', async () => {
    for (const status of ['posting', 'fixing', 'challenging', 'reviewing']) {
      const { gateway } = gatewayOver({
        '/run': { body: run({ status: 'blocked' }) },
        '/decisions': { body: decisions({ decisions: [decision({ status })] }) },
      })
      expect((await gateway.getStatus('task-1')).status).toBe('running')
    }
  })

  it('treats a run waiting on something else entirely as still running', async () => {
    for (const status of ['running', 'blocked', 'paused', 'something_new']) {
      const { gateway } = gatewayOver({
        '/run': { body: run({ status }) },
        '/decisions': { body: decisions({ decisions: [], parked: false }) },
      })
      const reported = await gateway.getStatus('task-1')
      expect(reported.status).toBe('running')
      expect(reported.curation).toBeNull()
    }
  })
})

describe('CatFactoryAiReviewGateway curation', () => {
  it('posts the curated selection to the resolve route', async () => {
    const { gateway, calls } = gatewayOver({ '/pr-review/resolve': { body: decisions() } })

    await gateway.resolveReview({ runId: 'run-1', action: 'post', findingIds: ['f-1', 'f-2'] })

    expect(calls).toStrictEqual([
      {
        method: 'POST',
        path: '/api/v1/runs/run-1/decisions/pr-review/resolve',
        body: { action: 'post', findingIds: ['f-1', 'f-2'] },
      },
    ])
  })

  /**
   * The dismissal answer is KEPT, unlike the two asynchronous verbs: the drop is
   * synchronous curation that leaves the run parked, so the list cat-factory
   * hands back is the whole effect and a re-poll would spend two more calls to
   * learn the same thing.
   */
  it('dismisses one finding by id and answers with the review the drop left', async () => {
    const { gateway, calls } = gatewayOver({
      '/dismiss': { body: decisions({ decisions: [decision({ findings: [] })] }) },
    })

    const curation = await gateway.dismissFinding({ runId: 'run-1', findingId: 'f-1' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/api/v1/runs/run-1/decisions/pr-review/findings/f-1/dismiss')
    expect(curation?.status).toBe('awaiting_selection')
    expect(curation?.findings).toStrictEqual([])
  })

  it('resumes a stalled review without saying which slices to redo', async () => {
    const { gateway, calls } = gatewayOver({ '/pr-review/resume': { body: decisions() } })
    await gateway.resumeReview({ runId: 'run-1' })
    expect(calls[0]).toStrictEqual({
      method: 'POST',
      path: '/api/v1/runs/run-1/decisions/pr-review/resume',
      body: null,
    })
  })

  /**
   * A refusal a person can act on, kept apart from an upstream fault. A resume of
   * a review that is not in progress is 409 for ever, so retrying it is not the
   * answer and it must not be reported as a fault worth retrying.
   */
  it('reports a review that has moved on as a conflict rather than an upstream fault', async () => {
    const { gateway } = gatewayOver({
      '/pr-review/resume': {
        status: 409,
        body: { error: { code: 'not_resumable', message: 'the review is not in progress' } },
      },
    })
    await expect(gateway.resumeReview({ runId: 'run-1' })).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('names the scope a key needs when cat-factory refuses the verb outright', async () => {
    const { gateway } = gatewayOver({
      '/pr-review/resolve': {
        status: 403,
        body: { error: { code: 'insufficient_scope', message: 'needs decide' } },
      },
    })
    await expect(
      gateway.resolveReview({ runId: 'run-1', action: 'post', findingIds: ['f-1'] }),
    ).rejects.toMatchObject({ code: 'forbidden', message: /`decide` scope/ })
  })

  it('reports a finding a stale screen clicked twice as gone, not as a fault', async () => {
    const { gateway } = gatewayOver({
      '/dismiss': {
        status: 404,
        body: { error: { code: 'not_found', message: 'no such finding' } },
      },
    })
    await expect(
      gateway.dismissFinding({ runId: 'run-1', findingId: 'f-1' }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reports a cat-factory fault as upstream, so nobody looks for it in here', async () => {
    const { gateway } = gatewayOver({
      '/pr-review/resolve': {
        status: 500,
        body: { error: { code: 'internal', message: 'boom' } },
      },
    })
    await expect(
      gateway.resolveReview({ runId: 'run-1', action: 'finish', findingIds: [] }),
    ).rejects.toMatchObject({ code: 'upstream_failed' })
  })
})
