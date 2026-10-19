import type {
  AiReviewCuration,
  ReviewRequest,
  RiskAssessment,
  RiskPolicyInput,
} from '@sainte-beuve/contracts'
import type { ChangedFile, Deferral, GatewayFactory, VcsGateway } from '@sainte-beuve/kernel'
import { expect } from 'vitest'
import type { AppContainer } from '../src/container.js'
import { ReviewIntake } from '../src/modules/webhooks/ReviewIntake.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import {
  buildHarness,
  get,
  post,
  PR,
  put,
  stubGateways,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// The risk suites' harness: a host that records what it was asked to approve,
// deferred work a case settles, and the org's policy set over a repository it
// holds. Shared by the risk policy suite and the automation suite.

const DOCS: ChangedFile[] = [
  { path: 'docs/guide.md', previousPath: null, status: 'modified', additions: 12, deletions: 3 },
]

export const RISKY: ChangedFile[] = [
  {
    path: 'src/auth/session.ts',
    previousPath: null,
    status: 'modified',
    additions: 180,
    deletions: 40,
  },
  {
    path: 'migrations/0009_users.sql',
    previousPath: null,
    status: 'added',
    additions: 30,
    deletions: 0,
  },
]

export const APPROVING: RiskPolicyInput = {
  assess: true,
  autoApprove: true,
  classRules: { docs: 'always' },
}

/** A host whose pull request #7 changes `files` at `head`, recording what it was asked to approve. */
export function host(author = 'author') {
  const state = { files: DOCS, head: 'sha-1', draft: false }
  const approvals: { headSha: string; body: string }[] = []
  const withdrawals: { approvalId: string | null; message: string }[] = []
  const base = viewerVcs('installation')
  const gateway: VcsGateway = {
    ...base,
    pullRequestStatus: async (pr) => ({
      ...(await base.pullRequestStatus(pr)),
      authorLogin: author,
      headSha: state.head,
      draft: state.draft,
    }),
    changedFiles: async () => ({ files: state.files, truncated: false }),
    approve: async (_pr, input) => {
      approvals.push(input)
      return { approvalId: `approval-${approvals.length}`, bodyPosted: true }
    },
    withdrawApproval: async (_pr, input) => {
      withdrawals.push(input)
      return { messagePosted: true }
    },
  }
  return { gateway, state, approvals, withdrawals }
}

/** The runtime's `waitUntil`, held so a case can wait for what a request started. */
export function collected(): { defer: Deferral; settle: () => Promise<void> } {
  const work: Promise<unknown>[] = []
  return {
    defer: (promise) => {
      work.push(promise)
    },
    settle: async () => {
      while (work.length > 0) await work.shift()
    },
  }
}

const APP_WIRING = { appSlug: 'sainte-beuve', webhookSecret: null, botLogin: null }

/** A deployment whose GitHub App reads the pull request and approves it. */
export function appHarness(
  github = host(),
  gateways: Partial<GatewayFactory> = {},
  container: Partial<AppContainer> = {},
) {
  const deferred = collected()
  const harness = buildHarness({
    defer: deferred.defer,
    github: APP_WIRING,
    gateways: stubGateways({
      vcsAsApp: (provider) => (provider === 'github' ? github.gateway : null),
      ...gateways,
    }),
    ...container,
  })
  return { harness, github, settle: deferred.settle }
}

/** The org's policy, set after it registers the repository PR #7 is in, which approving needs. */
export async function setPolicy(harness: TestHarness, policy: RiskPolicyInput): Promise<Response> {
  await holdRepository(harness)
  return harness.app.fetch(put('/api/v1/settings/risk-policy', policy))
}

async function holdRepository(harness: TestHarness): Promise<void> {
  await harness.app.fetch(
    post('/api/v1/projects', { provider: PR.provider, owner: PR.owner, repo: PR.repo }),
  )
}

export async function assessmentOf(
  harness: TestHarness,
  reviewId: string,
): Promise<RiskAssessment | null> {
  const res = await harness.app.fetch(get(`/api/v1/reviews/${reviewId}/risk-assessment`))
  expect(res.status).toBe(200)
  return ((await res.json()) as { assessment: RiskAssessment | null }).assessment
}

export async function reviewOf(harness: TestHarness, reviewId: string): Promise<ReviewRequest> {
  return (await (
    await harness.app.fetch(get(`/api/v1/reviews/${reviewId}`))
  ).json()) as ReviewRequest
}

/**
 * A pull request opening on the host, as the intake performs it. Not `ready`
 * is a track that is not a new review request: a reopen, or a label.
 */
export async function opened(harness: TestHarness, ready = true): Promise<string> {
  const outcome = await new ReviewIntake(harness.container).perform({
    kind: 'track',
    route: false,
    ready,
    review: {
      pullRequest: PR,
      title: 'Document the health check',
      authorLogin: 'author',
      requiredSkills: [],
      priority: 'normal',
      dueAt: null,
    },
  })
  return outcome.reviewId as string
}

export function parkedWith(
  severities: ('blocker' | 'high' | 'medium' | 'low' | 'nit')[],
): AiReviewCuration {
  return {
    status: 'awaiting_selection',
    findings: severities.map((severity, index) => ({
      findingId: `f-${index}`,
      title: 'A finding',
      detail: 'Detail',
      path: 'docs/guide.md',
      line: 3,
      side: 'RIGHT',
      severity,
      category: 'correctness',
      suggestedFix: null,
      sliceId: null,
      challenge: null,
    })),
    selectedFindingIds: [],
    postedFindingIds: [],
    postedBody: false,
    postAttempts: 0,
    postReport: null,
    sliceCount: 1,
    reportedSliceCount: 1,
    lastActivityAt: null,
    resumeAttempts: 0,
    maxResumeAttempts: 2,
    summary: null,
    slices: [],
  }
}

/** A deployment with cat-factory connected, holding PR #7's repository. */
export async function wired(gateways: Partial<GatewayFactory>) {
  const github = host()
  const deferred = collected()
  const harness = buildHarness({
    ...catFactoryWired({}),
    defer: deferred.defer,
    github: APP_WIRING,
    gateways: stubGateways({ vcsAsApp: () => github.gateway, ...gateways }),
  })
  // Before cat-factory is connected, since its directory decides the repositories after.
  await holdRepository(harness)
  await connectCatFactory(harness)
  return { harness, github, settle: deferred.settle }
}
