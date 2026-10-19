import {
  CatFactoryApiError,
  CatFactoryClient,
  CatFactoryConnectionError,
  CatFactoryDecodeError,
  CatFactoryNotFoundError,
  CatFactoryTimeoutError,
  CatFactoryUnauthorizedError,
  CatFactoryValidationError,
} from '@cat-factory/sdk'
import {
  type CatFactoryAccess,
  type CatFactoryProbe,
  type CatFactoryProbeReport,
  withDeadline,
} from '@sainte-beuve/kernel'
import { appUrlOf } from './catFactoryApp.js'
import { WorkspaceClients } from './workspaceClients.js'

export interface CatFactoryProbeOptions extends CatFactoryAccess {
  /** Swap the HTTP implementation. The SDK's own seam, so a suite needs no live instance. */
  fetch?: typeof globalThis.fetch
}

/** A failed call, with the request it was, so the screen can say which one to look at. */
class ProbeFailure extends Error {
  constructor(
    readonly request: string,
    readonly failure: unknown,
  ) {
    super(request)
  }
}

/** A key whose directory lists no workspace, so there is nowhere to ask the rest. */
class NoWorkspaces extends Error {}

/** The request a call is, as the screen names it. Null is the key's only workspace. */
function requestName(path: string, workspaceId: string | null): string {
  return workspaceId === null ? `GET ${path}` : `GET ${path} in workspace ${workspaceId}`
}

async function asking<T>(request: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    throw new ProbeFailure(request, err)
  }
}

/** cat-factory's refusal of a workspace-scoped call that names no workspace for a key reaching several. */
function workspaceRequired(err: unknown): boolean {
  return (
    err instanceof CatFactoryValidationError &&
    (err.details as { reason?: unknown } | null)?.reason === 'workspace_required'
  )
}

function uniqueById<T extends { id: string }>(entries: readonly T[]): T[] {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()]
}

/**
 * Asks an instance three read-scope questions: who the key is, which services
 * it can file under, and which pipelines it can run. Every failure is reported
 * rather than thrown, because the caller is a screen whose whole job is to say
 * what is wrong.
 *
 * The three are workspace-scoped. A key reaching several workspaces is refused
 * them unless it names one, so for such a key the probe lists the workspaces it
 * reaches from the account-scoped directory and asks in each.
 */
export class CatFactoryProbeGateway implements CatFactoryProbe {
  private readonly clients: WorkspaceClients

  constructor(private readonly options: CatFactoryProbeOptions) {
    this.clients = new WorkspaceClients(
      (workspaceId) =>
        new CatFactoryClient({
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
          userAgent: 'sainte-beuve',
          fetch: withDeadline(options.fetch),
          ...(workspaceId === undefined ? {} : { workspaceId }),
        }),
    )
  }

  appUrl(configured: string | null): Promise<string> {
    return appUrlOf({ ...this.options, appUrl: configured })
  }

  async probe(): Promise<CatFactoryProbeReport> {
    try {
      const { scope, workspaces } = await this.identify()
      const offers = await Promise.all(workspaces.map((workspaceId) => this.offered(workspaceId)))
      return {
        outcome: 'ok',
        detail: null,
        scope,
        services: uniqueById(offers.flatMap((offer) => offer.services)),
        pipelines: uniqueById(offers.flatMap((offer) => offer.pipelines)),
      }
    } catch (err) {
      return { ...failureOf(err), scope: null, services: [], pipelines: [] }
    }
  }

  /** The key's scope, and the workspaces to ask in: `[null]` for a key with one. */
  private async identify(): Promise<{ scope: string; workspaces: (string | null)[] }> {
    try {
      return { scope: (await this.clients.in(null).me.get()).scope, workspaces: [null] }
    } catch (err) {
      if (!workspaceRequired(err)) throw new ProbeFailure(requestName('/api/v1/me', null), err)
    }
    const workspaces = await asking('GET /api/v1/directory/workspaces', async () => {
      const ids: string[] = []
      for await (const workspace of this.clients.in(null).directory.listWorkspacesAll()) {
        ids.push(workspace.id)
      }
      return ids
    })
    const first = workspaces[0]
    if (first === undefined) {
      throw new ProbeFailure('GET /api/v1/directory/workspaces', new NoWorkspaces())
    }
    const identity = await asking(requestName('/api/v1/me', first), () =>
      this.clients.in(first).me.get(),
    )
    return { scope: identity.scope, workspaces }
  }

  private async offered(workspaceId: string | null): Promise<{
    services: { id: string; title: string }[]
    pipelines: { id: string; name: string }[]
  }> {
    const client = this.clients.in(workspaceId)
    const [services, pipelines] = await Promise.all([
      asking(requestName('/api/v1/services', workspaceId), () => client.services.list()),
      asking(requestName('/api/v1/pipelines', workspaceId), () => client.pipelines.list()),
    ])
    return {
      services: services.services.map((s) => ({ id: s.serviceId, title: s.title })),
      pipelines: pipelines.pipelines.map((p) => ({ id: p.pipelineId, name: p.name })),
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
  const failure = err instanceof ProbeFailure ? err.failure : err
  const match = FAILURES.find(([type]) => failure instanceof type)
  const detail = detailOf(failure)
  return {
    outcome: match?.[1] ?? 'unreachable',
    detail: err instanceof ProbeFailure ? `${err.request}: ${detail}` : detail,
  }
}

/** A machine code as cat-factory spells one, and nothing that could carry a response body. */
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/

/** The code and `details.reason` of a refusal, each only when it reads as a machine code. */
function codesOf(err: CatFactoryApiError): string[] {
  const reason = (err.details as { reason?: unknown } | null)?.reason
  return [err.code, reason].filter(
    (code): code is string => typeof code === 'string' && ERROR_CODE.test(code),
  )
}

/**
 * What kind of failure it was, never the text of the answer. The URL is the
 * admin's to choose, so whatever answers there may not be cat-factory, and its
 * error text would otherwise come back to the screen verbatim.
 */
function detailOf(err: unknown): string {
  if (err instanceof CatFactoryApiError) {
    const codes = codesOf(err)
    return codes.length === 0 ? `HTTP ${err.status}` : `HTTP ${err.status} (${codes.join(', ')})`
  }
  if (err instanceof CatFactoryTimeoutError) return 'no answer before the deadline'
  if (err instanceof CatFactoryConnectionError) return 'no connection could be made'
  if (err instanceof CatFactoryDecodeError) return 'the answer was not a cat-factory API response'
  if (err instanceof NoWorkspaces) return 'the key reaches no workspace'
  return 'the request failed'
}
