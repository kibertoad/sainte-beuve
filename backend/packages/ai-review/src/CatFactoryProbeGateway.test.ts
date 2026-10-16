import { describe, expect, it } from 'vitest'
import { CatFactoryProbeGateway } from './CatFactoryProbeGateway.js'

function probeAnswering(response: () => Response): CatFactoryProbeGateway {
  return new CatFactoryProbeGateway({
    baseUrl: 'http://internal.example',
    apiKey: 'cf_live_key.secret',
    fetch: async () => response(),
  })
}

describe('CatFactoryProbeGateway', () => {
  it('reports the status of a refusal without repeating what the server said', async () => {
    const report = await probeAnswering(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'forbidden', message: 'internal secret text' } }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    ).probe()
    expect(report.outcome).toBe('refused')
    expect(report.detail).toBe('GET /api/v1/me: HTTP 403 (forbidden)')
  })

  it('reports an answer that is not cat-factory without its body', async () => {
    const report = await probeAnswering(
      () =>
        new Response('<html>internal secret text</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ).probe()
    expect(report.outcome).toBe('unreachable')
    expect(report.detail).not.toContain('internal secret text')
  })

  it('asks in every workspace a key reaching several can see, naming each', async () => {
    const asked: string[] = []
    const probe = new CatFactoryProbeGateway({
      baseUrl: 'http://internal.example',
      apiKey: 'cf_live_key.secret',
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname
        const workspace = new Headers(init?.headers).get('x-cat-factory-workspace')
        asked.push(workspace === null ? path : `${workspace} ${path}`)
        const [body, status] = answerFor(path, workspace)
        return json(body, status)
      },
    })

    const report = await probe.probe()

    expect(report).toStrictEqual({
      outcome: 'ok',
      detail: null,
      scope: 'decide',
      services: [
        { id: 'svc-ws-a', title: 'Service in ws-a' },
        { id: 'svc-ws-b', title: 'Service in ws-b' },
      ],
      pipelines: [{ id: 'pl_review', name: 'Review' }],
    })
    expect(asked).toContain('/api/v1/directory/workspaces')
    expect(asked).toContain('ws-b /api/v1/services')
  })

  it('names the request a workspace refused', async () => {
    const report = await probeAnswering(() =>
      json(
        { error: { code: 'forbidden', message: 'no', details: { reason: 'scope_too_narrow' } } },
        403,
      ),
    ).probe()
    expect(report.detail).toBe('GET /api/v1/me: HTTP 403 (forbidden, scope_too_narrow)')
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const WORKSPACE_REQUIRED = { reason: 'workspace_required' }

const ME = {
  keyId: 'key-1',
  accountId: 'acc-1',
  workspaceIds: null,
  scope: 'decide',
  label: 'sainte-beuve',
}

/** An instance where the key reaches ws-a and ws-b and names neither. */
function answerFor(path: string, workspace: string | null): [unknown, number] {
  if (path === '/api/v1/directory/workspaces') {
    const items = ['ws-a', 'ws-b'].map((id) => ({
      id,
      name: id,
      description: null,
      accessMode: 'account',
    }))
    return [{ asOfSeq: 1, items, nextCursor: null }, 200]
  }
  if (workspace === null) {
    const refusal = { code: 'validation', message: 'name one', details: WORKSPACE_REQUIRED }
    return [{ error: refusal }, 422]
  }
  if (path === '/api/v1/me') return [{ ...ME, workspaceId: workspace }, 200]
  if (path === '/api/v1/services') {
    return [
      { services: [{ serviceId: `svc-${workspace}`, title: `Service in ${workspace}` }] },
      200,
    ]
  }
  return [{ pipelines: [{ pipelineId: 'pl_review', name: 'Review' }] }, 200]
}
