import { CatFactoryAiReviewGateway } from './CatFactoryAiReviewGateway.js'

/**
 * The gateway is tested through the SDK's own `fetch` seam rather than by stubbing
 * the client: what these cases are about is the translation between a cat-factory
 * run and the AI-review port, and that translation only means anything on the wire
 * shape the SDK actually decodes.
 */
export interface Call {
  method: string
  path: string
  body: unknown
  /** The workspace the call named, or null for the key's only one. */
  workspace: string | null
}

/**
 * One canned answer, keyed by the path suffix the SDK asks for. A key of the
 * form `<workspace> <suffix>` answers only a call that names that workspace.
 */
export type Routes = Record<string, { status?: number; body: unknown }>

export function gatewayOver(
  routes: Routes,
  serviceId: string | null = 'svc-1',
  appUrl: string | null = null,
): {
  gateway: CatFactoryAiReviewGateway
  calls: Call[]
} {
  const calls: Call[] = []
  const gateway = new CatFactoryAiReviewGateway({
    baseUrl: 'https://cat-factory.example.com',
    appUrl,
    apiKey: 'cf_live_key.secret',
    serviceId,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname
      const raw = init?.body
      calls.push({
        method: init?.method ?? 'GET',
        path,
        body: typeof raw === 'string' ? JSON.parse(raw) : null,
        workspace: new Headers(init?.headers).get('x-cat-factory-workspace'),
      })
      const workspace = new Headers(init?.headers).get('x-cat-factory-workspace')
      const route = Object.entries(routes).find(([key]) => {
        const [only, suffix] = key.includes(' ') ? key.split(' ') : [null, key]
        return path.endsWith(suffix ?? '') && (only === null || only === workspace)
      })
      if (route === undefined) {
        return new Response(JSON.stringify({ error: { code: 'not_found', message: path } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(route[1].body), {
        status: route[1].status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { gateway, calls }
}

/** A gateway whose every call gets the same answer: `''` is a suffix of every path. */
export function gatewayAnswering(status: number, body: unknown): CatFactoryAiReviewGateway {
  return gatewayOver({ '': { status, body } }).gateway
}

export function run(overrides: Record<string, unknown> = {}) {
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

export function task(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    serviceId: 'svc-1',
    title: 'Review kibertoad/sainte-beuve#7',
    status: 'planned',
    runId: null,
    progress: 0,
    prUrl: null,
    createdAt: 0,
    ...overrides,
  }
}

export function finding(overrides: Record<string, unknown> = {}) {
  return {
    findingId: 'f-1',
    title: 'Unbounded retry',
    detail: 'The loop never gives up.',
    path: 'src/poll.ts',
    line: 42,
    side: 'RIGHT',
    severity: 'blocker',
    category: 'correctness',
    sliceId: 'slice-1',
    suggestedFix: null,
    challenge: null,
    ...overrides,
  }
}

export function decision(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'pr-review',
    status: 'awaiting_selection',
    findings: [finding()],
    selectedFindingIds: [],
    postedFindingIds: [],
    postedBody: false,
    postAttempts: 0,
    postReport: null,
    prUrl: 'https://github.com/kibertoad/sainte-beuve/pull/7',
    slices: [
      { sliceId: 'slice-1', title: 'polling', paths: ['src/poll.ts'], rationale: 'the loop' },
    ],
    reportedSlices: 1,
    resumeAttempts: 0,
    maxResumeAttempts: 3,
    lastActivityAt: 1_700_000,
    summary: null,
    ...overrides,
  }
}

export function decisions(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    status: 'blocked',
    parked: true,
    decisions: [decision()],
    unanswerable: [],
    ...overrides,
  }
}
