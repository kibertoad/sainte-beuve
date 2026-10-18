import { describe, expect, it } from 'vitest'
import { CatFactoryAiReviewGateway } from './CatFactoryAiReviewGateway.js'
import {
  decision,
  decisions,
  finding,
  gatewayAnswering,
  gatewayOver,
  run,
  task,
} from './gatewayHarness.test-support.js'

/** One pull request to file a review of. Only the fields the brief is built from. */
const PULL_REQUEST = {
  provider: 'github' as const,
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 7,
  url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
}

/** The task and run every poll and curation case asks about, filed in the key's only workspace. */
const TASK = { taskId: 'task-1', workspaceId: null }
const RUN = { runId: 'run-1', workspaceId: null }

function filing(gateway: CatFactoryAiReviewGateway, directoryKeys: readonly string[] = []) {
  return gateway.requestReview({
    pullRequest: PULL_REQUEST,
    title: 'Poll on the read',
    instructions: null,
    directoryKeys,
  })
}

/** A workspace's linked repositories, as `GET /api/v1/repos` lists them. */
function repos(...entries: { repoId: number; serviceId: string | null; provider?: string }[]) {
  return {
    repos: entries.map((entry) => ({
      defaultBranch: 'main',
      linkedElsewhere: false,
      monorepo: entry.serviceId === null,
      name: 'sainte-beuve',
      owner: 'kibertoad',
      private: false,
      provider: 'github',
      ...entry,
    })),
  }
}

/** One board service, as `GET /api/v1/services` lists it. */
function service(serviceId: string) {
  return { serviceId, title: serviceId, description: '', status: 'planned', type: 'service' }
}

describe('CatFactoryAiReviewGateway.requestConflictResolution', () => {
  it('files a resolve-conflicts task naming the pull request, and starts its own pipeline', async () => {
    const { gateway, calls } = gatewayOver({
      '/tasks': { body: task() },
      '/start': { body: task({ status: 'running', runId: 'run-1' }) },
    })

    const handle = await gateway.requestConflictResolution({
      pullRequest: PULL_REQUEST,
      directoryKeys: [],
    })

    expect(handle).toStrictEqual({
      taskId: 'task-1',
      url: 'https://cat-factory.example.com/?block=task-1&run=run-1',
      workspaceId: null,
    })
    // No workspace links the repository, and this key cannot say where to link it.
    expect(calls[0]?.path).toBe('/api/v1/directory/reach')
    expect(calls[1]?.body).toMatchObject({
      taskType: 'resolve-conflicts',
      fields: { prNumber: 7, prUrl: 'https://github.com/kibertoad/sainte-beuve/pull/7' },
      title: 'Resolve conflicts in kibertoad/sainte-beuve#7',
    })
    expect(calls[2]).toMatchObject({ path: '/api/v1/tasks/task-1/start', body: {} })
  })

  it('links the task into the app URL when the app is served apart from the API', async () => {
    const { gateway } = gatewayOver(
      {
        '/tasks': { body: task() },
        '/start': { body: task({ status: 'running', runId: 'run-1' }) },
      },
      'svc-1',
      'https://app.cat-factory.example.com',
    )

    const handle = await gateway.requestConflictResolution({
      pullRequest: PULL_REQUEST,
      directoryKeys: [],
    })

    expect(handle.url).toBe('https://app.cat-factory.example.com/?block=task-1&run=run-1')
  })

  it('files under the service backing the repository, in the workspace that links it', async () => {
    const { gateway, calls } = gatewayOver({
      '/repos': { body: repos({ repoId: 42, serviceId: 'svc-42' }) },
      '/tasks': { body: task({ serviceId: 'svc-42' }) },
      '/start': { body: task({ status: 'running' }) },
    })

    const handle = await gateway.requestConflictResolution({
      pullRequest: PULL_REQUEST,
      directoryKeys: ['ws-a/42'],
    })

    expect(handle.workspaceId).toBe('ws-a')
    expect(calls.map(({ path, workspace }) => ({ path, workspace }))).toStrictEqual([
      { path: '/api/v1/repos', workspace: 'ws-a' },
      { path: '/api/v1/services/svc-42/tasks', workspace: 'ws-a' },
      { path: '/api/v1/tasks/task-1/start', workspace: 'ws-a' },
    ])
  })

  /**
   * A default service linked to another repository would attach whichever pull
   * request there shares the number. The URL is what lets cat-factory refuse it.
   */
  it('passes on the refusal of a service linked to another repository, and starts nothing', async () => {
    const message =
      'That pull request belongs to kibertoad/sainte-beuve, but this service is linked to acme/api.'
    const { gateway, calls } = gatewayOver({
      '/tasks': {
        status: 422,
        body: {
          error: {
            code: 'validation_failed',
            message,
            details: { reason: 'attached_pr_repo_mismatch', expected: 'acme/api' },
          },
        },
      },
    })

    await expect(
      gateway.requestConflictResolution({ pullRequest: PULL_REQUEST, directoryKeys: [] }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(message),
      details: { upstream: 'cat-factory', reason: 'attached_pr_repo_mismatch' },
    })
    expect(calls.map((call) => call.path)).toStrictEqual([
      '/api/v1/directory/reach',
      '/api/v1/services/svc-1/tasks',
    ])
  })
})

describe('CatFactoryAiReviewGateway.requestReview', () => {
  it('files the task and starts it, and reports the handle the loop is tracked by', async () => {
    const { gateway, calls } = gatewayOver({
      '/tasks': { body: task() },
      '/start': { body: task({ status: 'running', runId: 'run-1' }) },
    })

    expect(await filing(gateway)).toStrictEqual({
      taskId: 'task-1',
      url: 'https://cat-factory.example.com/?block=task-1&run=run-1',
      workspaceId: null,
    })
    expect(calls.map((call) => call.path)).toStrictEqual([
      '/api/v1/directory/reach',
      '/api/v1/services/svc-1/tasks',
      '/api/v1/tasks/task-1/start',
    ])
    expect(calls[1]?.body).toMatchObject({ fields: { prNumber: 7, prUrl: PULL_REQUEST.url } })
  })

  it('files under the service backing the repository, in the workspace that links it', async () => {
    const { gateway, calls } = gatewayOver({
      '/repos': {
        body: repos({ repoId: 41, serviceId: 'svc-other' }, { repoId: 42, serviceId: 'svc-42' }),
      },
      '/tasks': { body: task({ serviceId: 'svc-42' }) },
      '/start': { body: task({ status: 'running', runId: 'run-1' }) },
    })

    const handle = await filing(gateway, ['ws-a/42'])
    expect(handle.workspaceId).toBe('ws-a')
    // The link pins the board the task was filed in, which is what opens it there.
    expect(handle.url).toBe('https://cat-factory.example.com/?ws=ws-a&block=task-1&run=run-1')
    expect(calls.map(({ path, workspace }) => ({ path, workspace }))).toStrictEqual([
      { path: '/api/v1/repos', workspace: 'ws-a' },
      { path: '/api/v1/services/svc-42/tasks', workspace: 'ws-a' },
      { path: '/api/v1/tasks/task-1/start', workspace: 'ws-a' },
    ])
  })

  it('does not take a project on another host that shares the repository id', async () => {
    const { gateway, calls } = gatewayOver({
      '/repos': {
        body: repos(
          { repoId: 42, serviceId: 'svc-gitlab', provider: 'gitlab' },
          { repoId: 42, serviceId: 'svc-42' },
        ),
      },
      '/tasks': { body: task({ serviceId: 'svc-42' }) },
      '/start': { body: task({ status: 'running' }) },
    })

    await filing(gateway, ['ws-a/42'])
    expect(calls[1]?.path).toBe('/api/v1/services/svc-42/tasks')
  })

  it('files under the default service when no service backs the repository', async () => {
    const { gateway, calls } = gatewayOver({
      '/repos': { body: repos({ repoId: 42, serviceId: null }) },
      '/services': { body: { services: [] } },
      '/tasks': { body: task() },
      '/start': { body: task({ status: 'running' }) },
    })

    expect((await filing(gateway, ['ws-a/42'])).workspaceId).toBeNull()
    expect(calls.slice(2).map(({ path, workspace }) => ({ path, workspace }))).toStrictEqual([
      { path: '/api/v1/services/svc-1/tasks', workspace: null },
      { path: '/api/v1/tasks/task-1/start', workspace: null },
    ])
  })

  /**
   * A key reaching several workspaces is refused a call that names none, so a
   * monorepo's review could never be filed under the default service there.
   */
  it('files the default service in the linking workspace that holds it', async () => {
    const { gateway, calls } = gatewayOver({
      '/repos': { body: repos({ repoId: 42, serviceId: null }) },
      'ws-b /services': { body: { services: [service('svc-1')] } },
      '/services': { body: { services: [service('svc-other')] } },
      '/tasks': { body: task() },
      '/start': { body: task({ status: 'running' }) },
    })

    expect((await filing(gateway, ['ws-a/42', 'ws-b/42'])).workspaceId).toBe('ws-b')
    expect(calls.slice(-2).map(({ path, workspace }) => ({ path, workspace }))).toStrictEqual([
      { path: '/api/v1/services/svc-1/tasks', workspace: 'ws-b' },
      { path: '/api/v1/tasks/task-1/start', workspace: 'ws-b' },
    ])
  })

  it('files where the repository is backed although another linking workspace refused', async () => {
    const { gateway, calls } = gatewayOver({
      'ws-a /repos': { status: 503, body: { error: { code: 'unavailable', message: 'down' } } },
      'ws-b /repos': { body: repos({ repoId: 42, serviceId: 'svc-42' }) },
      '/tasks': { body: task({ serviceId: 'svc-42' }) },
      '/start': { body: task({ status: 'running' }) },
    })

    expect((await filing(gateway, ['ws-a/42', 'ws-b/42'])).workspaceId).toBe('ws-b')
    expect(calls.at(-2)?.path).toBe('/api/v1/services/svc-42/tasks')
  })

  it('refuses with a link that adds the repository when nothing backs it and there is no default', async () => {
    const { gateway, calls } = gatewayOver(
      {
        '/repos': { body: repos() },
        '/deployment': { body: { appUrl: 'https://app.cat-factory.example.com/' } },
      },
      null,
    )

    await expect(filing(gateway, ['ws-a/42'])).rejects.toMatchObject({
      code: 'unavailable',
      message:
        /Add kibertoad\/sainte-beuve as a service in cat-factory, or set a default service id/,
      details: {
        reason: 'cat_factory_repository_missing',
        repository: 'kibertoad/sainte-beuve',
        provider: 'github',
        addRepositoryUrl:
          'https://app.cat-factory.example.com/?addRepo=kibertoad%2Fsainte-beuve&provider=github',
      },
    })
    expect(calls.map((call) => call.path)).toStrictEqual(['/api/v1/repos', '/api/v1/deployment'])
  })

  it('links into the configured app URL without asking cat-factory where its app is', async () => {
    const { gateway, calls } = gatewayOver(
      {
        '/repos': { body: repos() },
        '/deployment': { body: { appUrl: 'https://elsewhere.example.com' } },
      },
      null,
      'https://app.cat-factory.example.com',
    )

    await expect(filing(gateway, ['ws-a/42'])).rejects.toMatchObject({
      details: {
        addRepositoryUrl:
          'https://app.cat-factory.example.com/?addRepo=kibertoad%2Fsainte-beuve&provider=github',
      },
    })
    expect(calls.map((call) => call.path)).toStrictEqual(['/api/v1/repos'])
  })

  it('links into the API origin when cat-factory cannot say where its app is', async () => {
    const { gateway } = gatewayOver({ '/repos': { body: repos() } }, null)

    await expect(filing(gateway, ['ws-a/42'])).rejects.toMatchObject({
      details: {
        addRepositoryUrl:
          'https://cat-factory.example.com/?addRepo=kibertoad%2Fsainte-beuve&provider=github',
      },
    })
  })

  /**
   * Falling back here would file the review under another repository's service
   * because the key could not read the workspace, and say nothing about it.
   */
  it('does not fall back to the default when the workspace lookup is refused', async () => {
    const { gateway, calls } = gatewayOver({
      'ws-b /repos': { body: repos({ repoId: 42, serviceId: null }) },
      '/repos': { status: 401, body: { error: { code: 'unauthorized', message: 'no such key' } } },
    })

    await expect(filing(gateway, ['ws-a/42', 'ws-b/42'])).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(calls.map((call) => call.path)).toStrictEqual(['/api/v1/repos', '/api/v1/repos'])
  })

  it('asks about a run in the workspace it was filed in', async () => {
    const { gateway, calls } = gatewayOver({ '/run': { body: run({ status: 'done' }) } })

    await gateway.getStatus({ taskId: 'task-1', workspaceId: 'ws-a' })
    expect(calls.map(({ path, workspace }) => ({ path, workspace }))).toStrictEqual([
      { path: '/api/v1/tasks/task-1/run', workspace: 'ws-a' },
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

    expect(await gateway.getStatus(TASK)).toStrictEqual({
      status: 'completed',
      runId: 'run-1',
      summary: 'Two blocking findings.',
      failureReason: null,
      curation: null,

      progress: null,
    })
  })

  it('asks a settled run for no decisions, because it has none left to give', async () => {
    const { gateway, calls } = gatewayOver({
      '/run': { body: run({ status: 'done', steps: [] }) },
    })
    await gateway.getStatus(TASK)
    expect(calls.map((call) => call.path)).toStrictEqual(['/api/v1/tasks/task-1/run'])
  })

  it('reports why a run failed without passing it off as a verdict', async () => {
    const gateway = gatewayAnswering(
      200,
      run({ status: 'failed', error: { code: 'model_error', message: 'the model timed out' } }),
    )
    const reported = await gateway.getStatus(TASK)
    expect(reported.status).toBe('failed')
    expect(reported.summary).toBeNull()
    expect(reported.failureReason).toBe('the model timed out')
  })

  it('reports a cancelled run as cancelled, so nothing polls it for ever', async () => {
    const gateway = gatewayAnswering(200, run({ status: 'cancelled' }))
    expect((await gateway.getStatus(TASK)).status).toBe('cancelled')
  })

  it('treats the first poll of a task with no run yet as running', async () => {
    const gateway = gatewayAnswering(404, { error: { code: 'not_found', message: 'no run' } })
    expect(await gateway.getStatus(TASK)).toStrictEqual({
      status: 'running',
      runId: null,
      summary: null,
      failureReason: null,
      curation: null,

      progress: null,
    })
  })

  it('refuses upstream faults rather than reporting a verdict it does not have', async () => {
    const gateway = gatewayAnswering(500, { error: { code: 'internal', message: 'boom' } })
    await expect(gateway.getStatus(TASK)).rejects.toThrow(/could not report the run status/)
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

    const reported = await gateway.getStatus(TASK)
    expect(reported.status).toBe('running')
    expect(reported.curation).toBeNull()
  })

  it('reports a fault on the decision read as upstream, not as an empty review', async () => {
    const { gateway } = gatewayOver({
      '/run': { body: run({ status: 'blocked' }) },
      '/decisions': { status: 500, body: { error: { code: 'internal', message: 'boom' } } },
    })
    await expect(gateway.getStatus(TASK)).rejects.toMatchObject({ code: 'upstream_failed' })
  })

  it('reports a review parked on its findings as awaiting a selection', async () => {
    const { gateway } = gatewayOver({
      '/run': { body: run({ status: 'blocked' }) },
      '/decisions': { body: decisions() },
    })

    const reported = await gateway.getStatus(TASK)
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
          challenge: null,
          sliceId: 'slice-1',
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
      summary: null,
      slices: [
        { sliceId: 'slice-1', title: 'polling', rationale: 'the loop', paths: ['src/poll.ts'] },
      ],
      fixFindingIds: [],
      combinesPostAndFix: false,
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

    const reported = await gateway.getStatus(TASK)
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
      expect((await gateway.getStatus(TASK)).status).toBe('running')
    }
  })

  it('treats a run waiting on something else entirely as still running', async () => {
    for (const status of ['running', 'blocked', 'paused', 'something_new']) {
      const { gateway } = gatewayOver({
        '/run': { body: run({ status }) },
        '/decisions': { body: decisions({ decisions: [], parked: false }) },
      })
      const reported = await gateway.getStatus(TASK)
      expect(reported.status).toBe('running')
      expect(reported.curation).toBeNull()
    }
  })
})

describe('CatFactoryAiReviewGateway curation', () => {
  it('posts the curated selection to the resolve route, in the workspace of the run', async () => {
    const { gateway, calls } = gatewayOver({ '/pr-review/resolve': { body: decisions() } })

    await gateway.resolveReview({
      runId: 'run-1',
      workspaceId: 'ws-a',
      action: 'post',
      findingIds: ['f-1', 'f-2'],
      fixFindingIds: [],
    })

    expect(calls).toStrictEqual([
      {
        method: 'POST',
        path: '/api/v1/runs/run-1/decisions/pr-review/resolve',
        body: { action: 'post', findingIds: ['f-1', 'f-2'] },
        workspace: 'ws-a',
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

    const curation = await gateway.dismissFinding({
      runId: 'run-1',
      workspaceId: null,
      findingId: 'f-1',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/api/v1/runs/run-1/decisions/pr-review/findings/f-1/dismiss')
    expect(curation?.status).toBe('awaiting_selection')
    expect(curation?.findings).toStrictEqual([])
  })

  it('challenges one finding with the concern the curator wrote, in the workspace of the run', async () => {
    const { gateway, calls } = gatewayOver({ '/challenge': { body: decisions() } })

    await gateway.challengeFinding({
      runId: 'run-1',
      workspaceId: 'ws-a',
      findingId: 'f-1',
      question: ' Is it reachable? ',
    })

    expect(calls).toStrictEqual([
      {
        method: 'POST',
        path: '/api/v1/runs/run-1/decisions/pr-review/findings/f-1/challenge',
        body: { question: 'Is it reachable?' },
        workspace: 'ws-a',
      },
    ])
  })

  it('challenges with no concern by sending none, so the investigator asks its own', async () => {
    const { gateway, calls } = gatewayOver({ '/challenge': { body: decisions() } })
    await gateway.challengeFinding({ ...RUN, findingId: 'f-1', question: '  ' })
    expect(calls[0]?.body).toStrictEqual({})
  })

  it('reads the verdict back onto the finding', async () => {
    const verdict = { status: 'retracted', question: null, justification: 'The guard is upstream.' }
    const { gateway } = gatewayOver({
      '/run': { body: run({ status: 'blocked' }) },
      '/decisions': {
        body: decisions({ decisions: [decision({ findings: [finding({ challenge: verdict })] })] }),
      },
    })

    const reported = await gateway.getStatus(TASK)

    expect(reported.curation?.findings[0]?.challenge).toStrictEqual(verdict)
  })

  it('reports a challenge of a retracted finding as a conflict', async () => {
    const { gateway } = gatewayOver({
      '/challenge': {
        status: 409,
        body: {
          error: { code: 'conflict', message: 'A retracted finding can no longer be challenged.' },
        },
      },
    })
    await expect(
      gateway.challengeFinding({ ...RUN, findingId: 'f-1', question: null }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('resumes a stalled review without saying which slices to redo', async () => {
    const { gateway, calls } = gatewayOver({ '/pr-review/resume': { body: decisions() } })
    await gateway.resumeReview(RUN)
    expect(calls[0]).toStrictEqual({
      method: 'POST',
      path: '/api/v1/runs/run-1/decisions/pr-review/resume',
      body: null,
      workspace: null,
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
    await expect(gateway.resumeReview(RUN)).rejects.toMatchObject({
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
      gateway.resolveReview({
        runId: 'run-1',
        workspaceId: null,
        action: 'post',
        findingIds: ['f-1'],
        fixFindingIds: [],
      }),
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
      gateway.dismissFinding({ runId: 'run-1', workspaceId: null, findingId: 'f-1' }),
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
      gateway.resolveReview({
        runId: 'run-1',
        workspaceId: null,
        action: 'finish',
        findingIds: [],
        fixFindingIds: [],
      }),
    ).rejects.toMatchObject({ code: 'upstream_failed' })
  })
})
