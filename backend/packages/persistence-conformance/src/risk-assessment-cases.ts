import assert from 'node:assert/strict'
import type { RiskAssessment } from '@sainte-beuve/contracts'
import { type ConformanceCase, conformanceCase } from './case.js'
import { pullRequest } from './fixtures.js'
import { type TenancyCase, tenancyCase } from './tenancy-cases.js'

function assessment(reviewId: string, overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    reviewId,
    pullRequest: pullRequest(),
    status: 'approved',
    assessor: 'cat-factory',
    headSha: 'abc123',
    changeClass: 'docs',
    changedFileCount: 2,
    scores: { complexity: 0.1, risk: 0.05, impact: 0.2 },
    rationale: 'A README edit.',
    verdict: {
      outcome: 'within_policy',
      reason: 'class_auto_approve',
      exceededAxes: [],
      policyName: 'Balanced',
    },
    holdReason: null,
    aiReviewRunId: 'run-1',
    approvedAs: 'approver-bot',
    approvalId: '9001',
    attempts: 1,
    requestedAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  }
}

/** A row that has not been scored yet: every nullable null. */
function pending(reviewId: string, updatedAt: number): RiskAssessment {
  return assessment(reviewId, {
    status: 'pending',
    headSha: null,
    changeClass: null,
    changedFileCount: null,
    scores: null,
    rationale: null,
    verdict: null,
    aiReviewRunId: null,
    approvedAs: null,
    approvalId: null,
    attempts: 0,
    updatedAt,
  })
}

function byReview(rows: readonly RiskAssessment[]): RiskAssessment[] {
  return [...rows].sort((a, b) => (a.reviewId < b.reviewId ? -1 : 1))
}

export const riskAssessmentCases: readonly ConformanceCase[] = [
  conformanceCase('a risk assessment round-trips whole, nulls included', async (repos) => {
    const scored = assessment('r1')
    const unscored = pending('r2', 1_500)
    await repos.riskAssessments.put(scored)
    await repos.riskAssessments.put(unscored)
    assert.deepStrictEqual(await repos.riskAssessments.get('r1'), scored)
    assert.deepStrictEqual(await repos.riskAssessments.get('r2'), unscored)
    assert.strictEqual(await repos.riskAssessments.get('r3'), null)
  }),

  conformanceCase('a put replaces the assessment of the same review', async (repos) => {
    await repos.riskAssessments.put(pending('r1', 1_000))
    const replaced = assessment('r1', { status: 'requires_review', updatedAt: 3_000 })
    await repos.riskAssessments.put(replaced)
    assert.deepStrictEqual(await repos.riskAssessments.listByReviews(['r1']), [replaced])
  }),

  conformanceCase('assessments are read for the named reviews only', async (repos) => {
    const rows = ['r1', 'r2', 'r3'].map((id) => assessment(id))
    for (const row of rows) await repos.riskAssessments.put(row)
    const found = await repos.riskAssessments.listByReviews(['r3', 'r1', 'r1', 'missing'])
    assert.deepStrictEqual(byReview(found), [rows[0], rows[2]])
    assert.deepStrictEqual(await repos.riskAssessments.listByReviews([]), [])
  }),

  conformanceCase('more reviews than one statement binds are read in full', async (repos) => {
    const ids = Array.from({ length: 150 }, (_, index) => `r${String(index).padStart(3, '0')}`)
    for (const id of ids) await repos.riskAssessments.put(assessment(id))
    assert.strictEqual((await repos.riskAssessments.listByReviews(ids)).length, 150)
  }),

  conformanceCase(
    'in flight is pending and awaiting review, oldest first, capped',
    async (repos) => {
      await repos.riskAssessments.put(pending('late', 3_000))
      await repos.riskAssessments.put(
        assessment('waiting', { status: 'awaiting_ai_review', updatedAt: 1_000 }),
      )
      await repos.riskAssessments.put(pending('tie-b', 2_000))
      await repos.riskAssessments.put(pending('tie-a', 2_000))
      await repos.riskAssessments.put(assessment('settled', { updatedAt: 500 }))
      const inFlight = await repos.riskAssessments.listInFlight(3)
      assert.deepStrictEqual(
        inFlight.map((row) => row.reviewId),
        ['waiting', 'tie-a', 'tie-b'],
      )
    },
  ),
]

export const riskAssessmentTenancyCases: readonly TenancyCase[] = [
  tenancyCase('risk assessments belong to one org', async (stores) => {
    await stores.forOrg('org-a').riskAssessments.put(pending('r1', 1_000))
    await stores.forOrg('org-b').riskAssessments.put(assessment('r1'))
    assert.strictEqual((await stores.forOrg('org-a').riskAssessments.get('r1'))?.status, 'pending')
    assert.strictEqual((await stores.forOrg('org-b').riskAssessments.get('r1'))?.status, 'approved')
    assert.deepStrictEqual(
      (await stores.forOrg('org-b').riskAssessments.listInFlight(10)).map((row) => row.reviewId),
      [],
    )
  }),
]
