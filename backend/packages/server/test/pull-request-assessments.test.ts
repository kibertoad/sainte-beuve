import type { PullRequestAssessment, PullRequestAssessmentList } from '@sainte-beuve/contracts'
import type { ExternalRiskAssessment, PullRequestAddress } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import { buildHarness, PR, post, stubGateways, type TestHarness } from './helpers.js'

// The Assess button's two routes over `app.fetch`. What the assessor scores is
// cat-factory's business; under test is when it is asked and what is kept.

const SCORED: ExternalRiskAssessment = {
  headSha: 'sha-7',
  changeClass: 'source',
  changedFileCount: 3,
  scores: { risk: 0.4, impact: 0.2, complexity: 0.7 },
  rationale: 'Touches the billing path.',
  verdict: {
    outcome: 'requires_review',
    reason: 'exceeded_thresholds',
    exceededAxes: ['complexity'],
    policyName: 'Balanced',
  },
}

async function assessing(): Promise<{ harness: TestHarness; asked: PullRequestAddress[] }> {
  const asked: PullRequestAddress[] = []
  const harness = await connectCatFactory(
    buildHarness({
      ...catFactoryWired({}),
      gateways: stubGateways({
        riskAssessment: () => ({
          assess: async (input) => {
            asked.push(input.pullRequest)
            return SCORED
          },
          listPolicies: async () => [],
        }),
      }),
    }),
  )
  return { harness, asked }
}

async function assess(harness: TestHarness, pullRequest = PR): Promise<PullRequestAssessment> {
  const res = await harness.app.fetch(post('/api/v1/pull-request-assessments', { pullRequest }))
  expect(res.status).toBe(200)
  return (await res.json()) as PullRequestAssessment
}

describe('assessing a pull request', () => {
  it('asks cat-factory once, and answers the stored assessment after that', async () => {
    const { harness, asked } = await assessing()

    const first = await assess(harness)
    expect(first).toMatchObject({
      pullRequest: PR,
      headSha: 'sha-7',
      scores: { risk: 0.4, impact: 0.2, complexity: 0.7 },
      changeClass: 'source',
    })
    expect(await assess(harness)).toStrictEqual(first)
    expect(asked).toHaveLength(1)
  })

  it('looks up the stored assessments of the pull requests a list names', async () => {
    const { harness } = await assessing()
    await assess(harness)
    const other = { ...PR, number: PR.number + 1, url: `${PR.url}0` }

    const res = await harness.app.fetch(
      post('/api/v1/pull-request-assessments/lookup', { pullRequests: [PR, other] }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as PullRequestAssessmentList
    expect(body.assessments.map((row) => row.pullRequest.number)).toStrictEqual([PR.number])
  })

  it('refuses while cat-factory is not configured', async () => {
    const harness = buildHarness()
    const res = await harness.app.fetch(
      post('/api/v1/pull-request-assessments', { pullRequest: PR }),
    )
    expect(res.status).toBe(503)
  })
})
