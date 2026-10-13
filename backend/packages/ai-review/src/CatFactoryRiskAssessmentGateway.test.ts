import { UnavailableError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import {
  CatFactoryRiskAssessmentGateway,
  type PublicPrAssessment,
  toExternalAssessment,
} from './CatFactoryRiskAssessmentGateway.js'

const ANSWER: PublicPrAssessment = {
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
      verdict: { ...ANSWER.verdict, reason: 'something_new' },
    }).verdict
    expect(verdict.outcome).toBe('requires_review')
  })

  it('reads a change class it does not know as unknown', () => {
    expect(toExternalAssessment({ ...ANSWER, changeClass: 'binary' }).changeClass).toBe('unknown')
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

  it('refuses to assess on an SDK with no assessment surface', async () => {
    const gateway = gatewayAnswering({})
    const pullRequest = {
      provider: 'github',
      owner: 'acme',
      repo: 'api',
      number: 7,
      url: 'https://github.com/acme/api/pull/7',
    } as const
    await expect(
      gateway.assess({ pullRequest, policyId: null, directoryKeys: [] }),
    ).rejects.toBeInstanceOf(UnavailableError)
  })
})
