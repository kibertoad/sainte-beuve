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
    expect(report.detail).toBe('HTTP 403 (forbidden)')
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
})
