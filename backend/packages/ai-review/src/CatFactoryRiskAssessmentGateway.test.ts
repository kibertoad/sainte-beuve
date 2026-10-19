import type { PublicPrAssessment, PublicPrAssessmentVerdictReason } from '@cat-factory/sdk'
import { describe, expect, it } from 'vitest'
import {
  CatFactoryRiskAssessmentGateway,
  type PrAssessmentAnswer,
  toExternalAssessment,
} from './CatFactoryRiskAssessmentGateway.js'

const ANSWER: PrAssessmentAnswer = {
  headSha: 'abc',
  changeClass: 'docs',
  changedFileCount: 2,
  assessment: { complexity: 0.1, risk: 0.05, impact: 0.1, rationale: 'A README edit.' },
  policy: { policyId: 'mp_balanced', name: 'Balanced' },
  verdict: { outcome: 'within_policy', reason: 'class_auto_merge', exceededAxes: [] },
}

function gatewayAnswering(body: unknown, status = 200): CatFactoryRiskAssessmentGateway {
  return new CatFactoryRiskAssessmentGateway({
    baseUrl: 'http://cat-factory.example',
    apiKey: 'cf_live_key.secret',
    fetch: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  })
}

describe('toExternalAssessment', () => {
  it('reads cat-factory verdict under its own policy name', () => {
    expect(toExternalAssessment(ANSWER)).toEqual({
      headSha: 'abc',
      changeClass: 'docs',
      changedFileCount: 2,
      scores: { complexity: 0.1, risk: 0.05, impact: 0.1 },
      rationale: 'A README edit.',
      verdict: {
        outcome: 'within_policy',
        reason: 'class_auto_approve',
        exceededAxes: [],
        policyName: 'Balanced',
      },
    })
  })

  it('holds a pull request whose verdict reason this build does not know', () => {
    const verdict = toExternalAssessment({
      ...ANSWER,
      verdict: {
        ...ANSWER.verdict,
        reason: 'something_new' as PublicPrAssessmentVerdictReason,
      },
    }).verdict
    expect(verdict).toMatchObject({ outcome: 'requires_review', reason: 'unrecognised' })
  })

  it('reads a change class it does not know as unknown', () => {
    expect(
      toExternalAssessment({
        ...ANSWER,
        changeClass: 'binary' as PublicPrAssessment['changeClass'],
      }).changeClass,
    ).toBe('unknown')
  })
})

describe('CatFactoryRiskAssessmentGateway', () => {
  it('lists the policies a picker offers', async () => {
    const gateway = gatewayAnswering({
      policies: [
        {
          policyId: 'mp_balanced',
          name: 'Balanced',
          isDefault: true,
          isUnattendedDefault: false,
          autonomy: 'attended',
          autoMergeEnabled: true,
          ciMaxAttempts: 10,
          dryRunRoles: [],
          submissionRestrictedRoles: [],
        },
      ],
    })
    expect(await gateway.listPolicies()).toEqual([
      {
        policyId: 'mp_balanced',
        name: 'Balanced',
        isUnattendedDefault: false,
        autoMergeEnabled: true,
      },
    ])
  })

  it('names the admin scope when the key cannot list policies', async () => {
    const gateway = gatewayAnswering({ error: { code: 'forbidden', message: 'scope' } }, 403)
    await expect(gateway.listPolicies()).rejects.toThrow(/`admin` scope/)
  })

  it('assesses in the workspace the mirror names, under the named policy', async () => {
    const { gateway, calls } = routedGateway({ '/pr-assessments': { body: ASSESSED } })
    const assessed = await gateway.assess({
      pullRequest: PULL_REQUEST,
      policyId: 'mp_balanced',
      directoryKeys: ['ws-a/42'],
    })
    expect(assessed.verdict).toMatchObject({ outcome: 'within_policy', policyName: 'Balanced' })
    expect(calls).toStrictEqual([
      {
        path: '/api/v1/pr-assessments',
        workspace: 'ws-a',
        body: {
          owner: 'acme',
          repo: 'api',
          prNumber: 7,
          provider: 'github',
          riskPolicyId: 'mp_balanced',
        },
      },
    ])
  })

  /** A key reaching several workspaces is refused an assessment that names none. */
  it('asks the directory which workspace links a repository the mirror does not name', async () => {
    const { gateway, calls } = routedGateway({
      '/directory/repos': {
        body: directoryPage(
          { workspaceId: 'ws-z', owner: 'acme', name: 'web' },
          { workspaceId: 'ws-b', owner: 'Acme', name: 'API' },
        ),
      },
      '/pr-assessments': { body: ASSESSED },
    })
    await gateway.assess({ pullRequest: PULL_REQUEST, policyId: null, directoryKeys: [] })
    expect(calls.map(({ path, workspace }) => ({ path, workspace }))).toStrictEqual([
      { path: '/api/v1/directory/repos', workspace: null },
      { path: '/api/v1/pr-assessments', workspace: 'ws-b' },
    ])
  })

  it('offers to add a repository no workspace links instead of assessing it', async () => {
    const { gateway, calls } = routedGateway(
      { '/directory/repos': { body: directoryPage() } },
      'https://app.cat-factory.example',
    )
    await expect(
      gateway.assess({ pullRequest: PULL_REQUEST, policyId: null, directoryKeys: [] }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      details: {
        reason: 'cat_factory_repository_missing',
        repository: 'acme/api',
        addRepositoryUrl: 'https://app.cat-factory.example/?addRepo=acme%2Fapi&provider=github',
      },
    })
    expect(calls.map((call) => call.path)).toStrictEqual(['/api/v1/directory/repos'])
  })

  it('offers to add the repository when cat-factory says it is not linked', async () => {
    const { gateway } = routedGateway(
      {
        '/pr-assessments': {
          status: 404,
          body: {
            error: { code: 'not_found', message: 'gone', details: { reason: 'repo_not_linked' } },
          },
        },
      },
      'https://app.cat-factory.example',
    )
    await expect(
      gateway.assess({ pullRequest: PULL_REQUEST, policyId: null, directoryKeys: ['ws-a/42'] }),
    ).rejects.toMatchObject({ details: { reason: 'cat_factory_repository_missing' } })
  })

  it("asks the key's only workspace when the directory cannot be read", async () => {
    const { gateway, calls } = routedGateway({
      '/directory/repos': { status: 403, body: { error: { code: 'forbidden', message: 'no' } } },
      '/pr-assessments': { body: ASSESSED },
    })
    await gateway.assess({ pullRequest: PULL_REQUEST, policyId: null, directoryKeys: [] })
    expect(calls.at(-1)).toMatchObject({ path: '/api/v1/pr-assessments', workspace: null })
  })
})

const PULL_REQUEST = {
  provider: 'github',
  owner: 'acme',
  repo: 'api',
  number: 7,
  url: 'https://github.com/acme/api/pull/7',
} as const

const ASSESSED: PublicPrAssessment = {
  ...ANSWER,
  assessedAt: 1,
  model: 'm',
  owner: 'acme',
  repo: 'api',
  prNumber: 7,
  provider: 'github',
}

function directoryPage(...repos: { workspaceId: string; owner: string; name: string }[]) {
  return {
    asOfSeq: 1,
    nextCursor: null,
    items: repos.map((repo, index) => ({
      defaultBranch: 'main',
      monorepo: false,
      private: false,
      provider: 'github',
      repoId: 40 + index,
      ...repo,
    })),
  }
}

/** Answers keyed by path suffix; anything else is a 404. */
function routedGateway(
  routes: Record<string, { status?: number; body: unknown }>,
  appUrl: string | null = null,
) {
  const calls: { path: string; workspace: string | null; body: unknown }[] = []
  const gateway = new CatFactoryRiskAssessmentGateway({
    baseUrl: 'http://cat-factory.example',
    appUrl,
    apiKey: 'cf_live_key.secret',
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname
      const raw = init?.body
      calls.push({
        path,
        workspace: new Headers(init?.headers).get('x-cat-factory-workspace'),
        body: typeof raw === 'string' ? JSON.parse(raw) : null,
      })
      const route = Object.entries(routes).find(([suffix]) => path.endsWith(suffix))?.[1]
      return new Response(
        JSON.stringify(route?.body ?? { error: { code: 'not_found', message: path } }),
        {
          status: route === undefined ? 404 : (route.status ?? 200),
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  })
  return { gateway, calls }
}
