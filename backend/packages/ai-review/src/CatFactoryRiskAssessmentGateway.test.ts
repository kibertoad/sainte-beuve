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

  it('assesses in the workspace that links the repository, under the named policy', async () => {
    const calls: { url: string; body: unknown }[] = []
    const answer: PublicPrAssessment = {
      ...ANSWER,
      assessedAt: 1,
      model: 'm',
      owner: 'acme',
      repo: 'api',
      prNumber: 7,
      provider: 'github',
    }
    const gateway = new CatFactoryRiskAssessmentGateway({
      baseUrl: 'http://cat-factory.example',
      apiKey: 'cf_live_key.secret',
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        return new Response(JSON.stringify(answer), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    const pullRequest = {
      provider: 'github',
      owner: 'acme',
      repo: 'api',
      number: 7,
      url: 'https://github.com/acme/api/pull/7',
    } as const
    const assessed = await gateway.assess({
      pullRequest,
      policyId: 'mp_balanced',
      directoryKeys: [],
    })
    expect(assessed.verdict).toMatchObject({ outcome: 'within_policy', policyName: 'Balanced' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('/api/v1/pr-assessments')
    expect(calls[0]?.body).toEqual({
      owner: 'acme',
      repo: 'api',
      prNumber: 7,
      provider: 'github',
      riskPolicyId: 'mp_balanced',
    })
  })
})
