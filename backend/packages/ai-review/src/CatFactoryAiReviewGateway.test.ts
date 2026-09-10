import { describe, expect, it } from 'vitest'
import { CatFactoryAiReviewGateway } from './CatFactoryAiReviewGateway.js'

/**
 * The gateway is tested through the SDK's own `fetch` seam rather than by stubbing
 * the client: what these cases are about is the translation between a cat-factory
 * run and the AI-review port, and that translation only means anything on the wire
 * shape the SDK actually decodes.
 */
function gatewayAnswering(status: number, body: unknown): CatFactoryAiReviewGateway {
  return new CatFactoryAiReviewGateway({
    baseUrl: 'https://cat-factory.example.com',
    apiKey: 'cf_live_key.secret',
    serviceId: 'svc-1',
    fetch: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  })
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
      summary: 'Two blocking findings.',
      failureReason: null,
    })
  })

  it('reports why a run failed without passing it off as a verdict', async () => {
    const gateway = gatewayAnswering(
      200,
      run({ status: 'failed', error: { code: 'model_error', message: 'the model timed out' } }),
    )

    expect(await gateway.getStatus('task-1')).toStrictEqual({
      status: 'failed',
      summary: null,
      failureReason: 'the model timed out',
    })
  })

  it('reports a cancelled run as cancelled, so nothing polls it for ever', async () => {
    const gateway = gatewayAnswering(200, run({ status: 'cancelled' }))
    expect((await gateway.getStatus('task-1')).status).toBe('cancelled')
  })

  it('treats a run waiting on a human as still running', async () => {
    for (const status of ['running', 'blocked', 'paused', 'something_new']) {
      const gateway = gatewayAnswering(200, run({ status }))
      expect((await gateway.getStatus('task-1')).status).toBe('running')
    }
  })

  it('treats the first poll of a task with no run yet as running', async () => {
    const gateway = gatewayAnswering(404, { error: { code: 'not_found', message: 'no run' } })
    expect(await gateway.getStatus('task-1')).toStrictEqual({
      status: 'running',
      summary: null,
      failureReason: null,
    })
  })

  it('refuses upstream faults rather than reporting a verdict it does not have', async () => {
    const gateway = gatewayAnswering(500, { error: { code: 'internal', message: 'boom' } })
    await expect(gateway.getStatus('task-1')).rejects.toThrow(/cat-factory refused the run status/)
  })
})
