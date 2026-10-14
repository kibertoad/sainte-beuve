import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  AggregationTemporality,
  type GaugeMetricData,
  InMemoryMetricExporter,
} from '@opentelemetry/sdk-metrics'
import type { MilestoneStats, ReviewReport } from '@sainte-beuve/contracts'
import type { OrgReviewReport } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { headersFrom, otlpMetricsConfigFrom } from './config.js'
import { OtlpReviewMetricsExporter } from './OtlpReviewMetricsExporter.js'

const HOUR = 60 * 60 * 1000

function stats(medianMs: number | null, reached = 2, waiting = 1): MilestoneStats {
  return { reached, waiting, medianMs, p90Ms: medianMs, meanMs: medianMs }
}

function metrics(medianMs: number | null) {
  return {
    first_review: stats(medianMs),
    first_human_review: stats(medianMs),
    approval: stats(medianMs),
    merge: stats(null, 0, 3),
  }
}

function orgReport(): OrgReviewReport {
  const report: ReviewReport = {
    days: 30,
    since: 0,
    generatedAt: 30 * 24 * HOUR,
    projectId: null,
    pullRequests: 3,
    metrics: metrics(2 * HOUR),
    repositories: [
      {
        projectId: 'p1',
        provider: 'github',
        owner: 'acme',
        repo: 'api',
        pullRequests: 3,
        metrics: metrics(4 * HOUR),
      },
    ],
    hotspots: [
      {
        projectId: 'p1',
        milestone: 'first_review',
        reason: 'slow',
        medianMs: 4 * HOUR,
        overallMedianMs: 2 * HOUR,
        overdue: 0,
      },
    ],
    slowest: [],
    sources: [],
  }
  return { org: { id: 'org_default', slug: 'default' }, report }
}

/** Every gauge one export recorded, by name. */
async function exported(): Promise<Map<string, GaugeMetricData>> {
  const memory = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  await new OtlpReviewMetricsExporter(CONFIG, () => memory).export([orgReport()])
  const [resourceMetrics] = memory.getMetrics()
  expect(resourceMetrics?.resource.attributes['service.name']).toBe('sb-test')
  const metrics = resourceMetrics?.scopeMetrics[0]?.metrics ?? []
  return new Map(metrics.map((metric) => [metric.descriptor.name, metric as GaugeMetricData]))
}

function point(gauge: GaugeMetricData | undefined, attributes: Record<string, string>) {
  return gauge?.dataPoints.find((entry) =>
    Object.entries(attributes).every(([key, value]) => entry.attributes[key] === value),
  )
}

const CONFIG = { url: 'http://collector.invalid/v1/metrics', headers: {}, serviceName: 'sb-test' }

describe('OtlpReviewMetricsExporter', () => {
  it('records each milestone per org and per repository, with counts and hotspots', async () => {
    const byName = await exported()

    const firstReview = byName.get('sainte_beuve.review.time_to_first_review')
    expect(firstReview?.descriptor.unit).toBe('s')
    const points = firstReview?.dataPoints.map((entry) => [
      entry.attributes['sainte_beuve.report.scope'],
      entry.attributes['vcs.repository.name'] ?? null,
      entry.attributes['sainte_beuve.statistic'],
      entry.value,
    ])
    expect(points).toEqual(
      expect.arrayContaining([
        ['org', null, 'p50', 7200],
        ['repository', 'api', 'p50', 14400],
        ['repository', 'api', 'mean', 14400],
      ]),
    )
    expect(byName.get('sainte_beuve.review.time_to_merge')?.dataPoints ?? []).toEqual([])

    const waitingOnMerge = point(byName.get('sainte_beuve.review.pull_requests'), {
      'sainte_beuve.report.scope': 'org',
      'sainte_beuve.review.milestone': 'merge',
      'sainte_beuve.review.state': 'waiting',
    })
    expect(waitingOnMerge?.value).toBe(3)

    expect(byName.get('sainte_beuve.review.hotspot')?.dataPoints[0]?.attributes).toMatchObject({
      'sainte_beuve.org': 'default',
      'vcs.owner.name': 'acme',
      'vcs.repository.name': 'api',
      'sainte_beuve.review.milestone': 'first_review',
      'sainte_beuve.review.hotspot_reason': 'slow',
    })
  })

  it('pushes OTLP JSON to the collector over the official HTTP exporter', async () => {
    const received: { url: string; headers: Record<string, unknown>; body: unknown }[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        received.push({
          url: req.url ?? '',
          headers: req.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        })
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const config = otlpMetricsConfigFrom({
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}/`,
        OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=s%20ecret',
      })
      if (config === null) throw new Error('expected a configuration')
      await new OtlpReviewMetricsExporter(config).export([orgReport()])
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }

    expect(received).toHaveLength(1)
    expect(received[0]?.url).toBe('/v1/metrics')
    expect(received[0]?.headers['x-api-key']).toBe('s ecret')
    expect(JSON.stringify(received[0]?.body)).toContain(
      'sainte_beuve.review.time_to_first_human_review',
    )
  })
})

describe('otlpMetricsConfigFrom', () => {
  it('is off without an endpoint, and prefers the metrics-specific variables', () => {
    expect(otlpMetricsConfigFrom({})).toBeNull()
    expect(otlpMetricsConfigFrom({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' })).toBeNull()
    expect(
      otlpMetricsConfigFrom({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'https://metrics.example.com/custom',
        OTEL_EXPORTER_OTLP_HEADERS: 'a=1',
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'b=2',
        OTEL_SERVICE_NAME: 'reviews',
      }),
    ).toEqual({
      url: 'https://metrics.example.com/custom',
      headers: { b: '2' },
      serviceName: 'reviews',
    })
    expect(
      otlpMetricsConfigFrom({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com/' }),
    ).toEqual({
      url: 'https://otel.example.com/v1/metrics',
      headers: {},
      serviceName: 'sainte-beuve',
    })
  })

  it('reads headers as comma-separated pairs and skips the malformed ones', () => {
    expect(headersFrom('a=1, b = two%2Cthree ,=x,novalue')).toEqual({ a: '1', b: 'two,three' })
  })
})
