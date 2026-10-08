import {
  CatFactoryApiError,
  CatFactoryClient,
  CatFactoryNotFoundError,
  CatFactoryUnauthorizedError,
} from '@cat-factory/sdk'
import {
  type CatFactoryAccess,
  type CatFactoryProbe,
  type CatFactoryProbeReport,
  getErrorMessage,
  withDeadline,
} from '@sainte-beuve/kernel'

export interface CatFactoryProbeOptions extends CatFactoryAccess {
  /** Swap the HTTP implementation. The SDK's own seam, so a suite needs no live instance. */
  fetch?: typeof globalThis.fetch
}

/**
 * Asks an instance three read-scope questions: who the key is, which services
 * it can file under, and which pipelines it can run. Every failure is reported
 * rather than thrown, because the caller is a screen whose whole job is to say
 * what is wrong.
 */
export class CatFactoryProbeGateway implements CatFactoryProbe {
  private readonly client: CatFactoryClient

  constructor(options: CatFactoryProbeOptions) {
    this.client = new CatFactoryClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      userAgent: 'sainte-beuve',
      fetch: withDeadline(options.fetch),
    })
  }

  async probe(): Promise<CatFactoryProbeReport> {
    try {
      const identity = await this.client.me.get()
      const [services, pipelines] = await Promise.all([
        this.client.services.list(),
        this.client.pipelines.list(),
      ])
      return {
        outcome: 'ok',
        detail: null,
        scope: identity.scope,
        services: services.services.map((s) => ({ id: s.serviceId, title: s.title })),
        pipelines: pipelines.pipelines.map((p) => ({ id: p.pipelineId, name: p.name })),
      }
    } catch (err) {
      return { ...failureOf(err), scope: null, services: [], pipelines: [] }
    }
  }
}

/**
 * Which outcome each SDK refusal is, most specific first. A 404 on `/api/v1/me`
 * means the server is not cat-factory (or predates its public API), so like no
 * answer at all, and like an answer the SDK could not decode, it is the URL
 * that needs fixing.
 */
const FAILURES: readonly [new (...args: never[]) => Error, CatFactoryProbeReport['outcome']][] = [
  [CatFactoryUnauthorizedError, 'unauthorized'],
  [CatFactoryNotFoundError, 'unreachable'],
  [CatFactoryApiError, 'refused'],
]

function failureOf(err: unknown): Pick<CatFactoryProbeReport, 'outcome' | 'detail'> {
  const match = FAILURES.find(([type]) => err instanceof type)
  return { outcome: match?.[1] ?? 'unreachable', detail: getErrorMessage(err) }
}
