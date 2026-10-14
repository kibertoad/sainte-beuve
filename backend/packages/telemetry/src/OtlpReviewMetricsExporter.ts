import { ExportResultCode } from '@opentelemetry/core'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  AggregationTemporality,
  MeterProvider,
  MetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics'
import type { OrgReviewReport, ReviewMetricsExporter } from '@sainte-beuve/kernel'
import type { OtlpMetricsConfig } from './config.js'
import { createGauges, recordReport } from './instruments.js'

const SCOPE_NAME = '@sainte-beuve/telemetry'

/**
 * Collects only when told to. The SDK's periodic reader starts a timer of its
 * own, which a Worker invocation does not outlive and which would re-push the
 * last pass's values between passes on Node.
 */
class OnDemandMetricReader extends MetricReader {
  constructor(private readonly exporter: PushMetricExporter) {
    super({
      aggregationTemporalitySelector: (type) =>
        exporter.selectAggregationTemporality?.(type) ?? AggregationTemporality.CUMULATIVE,
    })
  }

  protected async onForceFlush(): Promise<void> {
    const { resourceMetrics, errors } = await this.collect()
    if (errors.length > 0) throw new AggregateError(errors, 'Could not collect the review metrics')
    await new Promise<void>((resolve, reject) => {
      this.exporter.export(resourceMetrics, (result) => {
        if (result.code === ExportResultCode.SUCCESS) resolve()
        else reject(result.error ?? new Error('The OTLP collector refused the review metrics'))
      })
    })
  }

  protected async onShutdown(): Promise<void> {
    await this.exporter.shutdown()
  }
}

/** A fresh exporter per pass, for {@link OtlpReviewMetricsExporter}; replaceable in a test. */
export type PushExporterFactory = (config: OtlpMetricsConfig) => PushMetricExporter

const otlpHttp: PushExporterFactory = (config) =>
  new OTLPMetricExporter({ url: config.url, headers: config.headers })

/**
 * The review metrics as OpenTelemetry gauges, pushed over OTLP/HTTP.
 *
 * Every pass builds its own meter provider, records the reports and flushes
 * once. A gauge left from the previous pass would keep reporting a repository
 * somebody unlinked, and nothing would ever clear it; a provider per pass
 * reports exactly what this pass read, on a Worker and on Node alike.
 */
export class OtlpReviewMetricsExporter implements ReviewMetricsExporter {
  constructor(
    private readonly config: OtlpMetricsConfig,
    private readonly pushExporter: PushExporterFactory = otlpHttp,
  ) {}

  async export(reports: readonly OrgReviewReport[]): Promise<void> {
    const reader = new OnDemandMetricReader(this.pushExporter(this.config))
    const provider = new MeterProvider({
      resource: resourceFromAttributes({ 'service.name': this.config.serviceName }),
      readers: [reader],
    })
    try {
      const gauges = createGauges(provider.getMeter(SCOPE_NAME))
      for (const report of reports) recordReport(gauges, report)
      await provider.forceFlush()
    } finally {
      await provider.shutdown()
    }
  }
}
