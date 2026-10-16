import assert from 'node:assert/strict'
import type { PullRequestAssessment } from '@sainte-beuve/contracts'
import { type ConformanceCase, conformanceCase } from './case.js'
import { type TenancyCase, tenancyCase } from './tenancy-cases.js'

function assessment(number: number, risk = 0.4, assessedAt = 1_000): PullRequestAssessment {
  return {
    pullRequest: {
      provider: 'github',
      owner: 'acme',
      repo: 'api',
      number,
      url: `https://github.com/acme/api/pull/${number}`,
    },
    headSha: `sha-${number}`,
    scores: { risk, impact: 0.2, complexity: 0.6 },
    changeClass: 'source',
    rationale: 'Touches the billing path.',
    assessedAt,
  }
}

export const pullRequestAssessmentCases: readonly ConformanceCase[] = [
  conformanceCase('a pull request assessment round-trips and replaces the last', async (repos) => {
    const first = assessment(1)
    await repos.pullRequestAssessments.put(first)
    assert.deepStrictEqual(await repos.pullRequestAssessments.get(first.pullRequest), first)
    const second = assessment(1, 0.9, 2_000)
    await repos.pullRequestAssessments.put(second)
    assert.deepStrictEqual(await repos.pullRequestAssessments.get(first.pullRequest), second)
  }),

  conformanceCase(
    'pull request assessments list for the pull requests named that have one',
    async (repos) => {
      await repos.pullRequestAssessments.put(assessment(1))
      await repos.pullRequestAssessments.put(assessment(2))
      await repos.pullRequestAssessments.put(assessment(3))
      const found = await repos.pullRequestAssessments.listByPullRequests([
        assessment(1).pullRequest,
        assessment(3).pullRequest,
        assessment(1).pullRequest,
        assessment(9).pullRequest,
      ])
      assert.deepStrictEqual(found.map((row) => row.pullRequest.number).sort(), [1, 3])
      assert.deepStrictEqual(await repos.pullRequestAssessments.listByPullRequests([]), [])
    },
  ),

  conformanceCase('a pull request with no assessment reads as null', async (repos) => {
    assert.strictEqual(await repos.pullRequestAssessments.get(assessment(5).pullRequest), null)
  }),
]

export const pullRequestAssessmentTenancyCases: readonly TenancyCase[] = [
  tenancyCase('pull request assessments belong to one org', async (stores) => {
    await stores.forOrg('org-a').pullRequestAssessments.put(assessment(1))
    assert.strictEqual(
      await stores.forOrg('org-b').pullRequestAssessments.get(assessment(1).pullRequest),
      null,
    )
  }),
]
