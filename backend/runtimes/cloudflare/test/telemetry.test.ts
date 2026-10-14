import { OtlpReviewMetricsExporter } from '@sainte-beuve/telemetry'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The OpenTelemetry SDK and its OTLP/HTTP exporter are Node-first packages, so
// what only this suite can say is that the build the Worker bundles pushes from
// inside workerd. The gauges themselves are tested in @sainte-beuve/telemetry.
describe('review metrics export on workerd', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pushes the gauges to the collector over fetch', async () => {
    const pushed: { url: string; body: string; apiKey: string | null }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      pushed.push({
        url: request.url,
        body: await request.text(),
        apiKey: request.headers.get('x-api-key'),
      })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const exporter = new OtlpReviewMetricsExporter({
      url: 'https://collector.example.com/v1/metrics',
      headers: { 'x-api-key': 'k' },
      serviceName: 'sainte-beuve',
    })
    await exporter.export([
      {
        org: { id: 'org_default', slug: 'default' },
        report: {
          days: 30,
          since: 0,
          generatedAt: 0,
          projectId: null,
          pullRequests: 1,
          metrics: {
            first_review: { reached: 1, waiting: 0, medianMs: 1000, p90Ms: 1000, meanMs: 1000 },
            first_human_review: {
              reached: 1,
              waiting: 0,
              medianMs: 1000,
              p90Ms: 1000,
              meanMs: 1000,
            },
            approval: { reached: 0, waiting: 1, medianMs: null, p90Ms: null, meanMs: null },
            merge: { reached: 0, waiting: 1, medianMs: null, p90Ms: null, meanMs: null },
          },
          repositories: [],
          hotspots: [],
          people: [],
          slowest: [],
          sources: [],
        },
      },
    ])

    expect(pushed).toHaveLength(1)
    expect(pushed[0]?.url).toBe('https://collector.example.com/v1/metrics')
    expect(pushed[0]?.apiKey).toBe('k')
    expect(pushed[0]?.body).toContain('sainte_beuve.review.time_to_first_review')
  })
})
