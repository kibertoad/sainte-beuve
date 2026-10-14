/**
 * Where the review metrics go, read from the OpenTelemetry SDK's own
 * environment variables so a deployment configures this the way it configures
 * any other OTLP exporter.
 */
export interface OtlpMetricsConfig {
  /** The full OTLP/HTTP metrics URL, `/v1/metrics` included. */
  url: string
  headers: Record<string, string>
  serviceName: string
}

/** The variables read, as a Worker's bindings or a process environment carries them. */
export interface OtlpEnvironment {
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?: string
  OTEL_EXPORTER_OTLP_ENDPOINT?: string
  OTEL_EXPORTER_OTLP_METRICS_HEADERS?: string
  OTEL_EXPORTER_OTLP_HEADERS?: string
  OTEL_SERVICE_NAME?: string
}

export const DEFAULT_SERVICE_NAME = 'sainte-beuve'

const METRICS_PATH = 'v1/metrics'

/**
 * The exporter's configuration, or null when no endpoint is set. The
 * metrics-specific variables win over the general ones, as the specification
 * orders them, and the general endpoint gets the metrics path appended while the
 * specific one is taken as written.
 */
export function otlpMetricsConfigFrom(env: OtlpEnvironment): OtlpMetricsConfig | null {
  const url = urlFrom(env)
  if (url === null) return null
  return {
    url,
    headers: headersFrom(
      env.OTEL_EXPORTER_OTLP_METRICS_HEADERS || env.OTEL_EXPORTER_OTLP_HEADERS || '',
    ),
    serviceName: env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
  }
}

function urlFrom(env: OtlpEnvironment): string | null {
  const specific = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim()
  if (specific) return specific
  const general = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!general) return null
  return `${general.replace(/\/+$/, '')}/${METRICS_PATH}`
}

/**
 * `key=value` pairs separated by commas, values percent-decoded, as the
 * specification spells them. A pair with no `=` or no key is skipped.
 */
export function headersFrom(value: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of value.split(',')) {
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const key = pair.slice(0, separator).trim()
    if (key.length === 0) continue
    headers[key] = decode(pair.slice(separator + 1).trim())
  }
  return headers
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
