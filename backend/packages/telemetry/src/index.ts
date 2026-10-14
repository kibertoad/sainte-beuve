// `@sainte-beuve/telemetry`: the review metrics as OpenTelemetry gauges, pushed
// to an OTLP/HTTP collector.

export {
  DEFAULT_SERVICE_NAME,
  headersFrom,
  type OtlpEnvironment,
  type OtlpMetricsConfig,
  otlpMetricsConfigFrom,
} from './config.js'
export { DURATION_METRICS, HOTSPOT_METRIC, PULL_REQUESTS_METRIC } from './instruments.js'
export { OtlpReviewMetricsExporter, type PushExporterFactory } from './OtlpReviewMetricsExporter.js'
