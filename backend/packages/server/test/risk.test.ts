import type { RiskAssessment, RiskPolicySettings } from '@sainte-beuve/contracts'
import type { ExternalRiskAssessment } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { DRIVE_LEASE_MS } from '../src/modules/risk/RiskAssessmentService.js'
import { ReviewIntake } from '../src/modules/webhooks/ReviewIntake.js'
import { runReminderTick } from '../src/reminders/tick.js'
import { stubAiReview } from './ai-review-doubles.js'
import {
  buildHarness,
  environmentVcs,
  get,
  openReview,
  post,
  PR,
  put,
  stubGateways,
  type TestHarness,
} from './helpers.js'
import {
  APPROVING,
  appHarness,
  assessmentOf,
  collected,
  host,
  opened,
  parkedWith,
  reviewOf,
  RISKY,
  setPolicy,
  wired,
} from './risk-harness.js'

// Assessing the board's pull requests and approving the ones the org's risk
// policy lets through, with nobody looking. Every case drives the deferred work
// to completion before it asserts, the way a runtime's `waitUntil` would.

describe('the risk policy', () => {
  it('starts assessing nothing, and reports who would approve', async () => {
    const { harness } = appHarness()
    const settings = (await (
      await harness.app.fetch(get('/api/v1/settings/risk-policy'))
    ).json()) as RiskPolicySettings
    expect(settings.policy).toMatchObject({
      assess: false,
      autoApprove: false,
      assessor: 'heuristic',
    })
    expect(settings.approvers).toEqual({
      github: { source: 'app', username: 'sainte-beuve[bot]' },
      gitlab: { source: null, username: null },
    })
    expect(settings.catFactoryAvailable).toBe(false)
  })

  it('refuses a cat-factory policy over a pull request cat-factory did not assess', async () => {
    const { harness } = appHarness()
    const res = await setPolicy(harness, { assessor: 'heuristic', policySource: 'cat-factory' })
    expect(res.status).toBe(400)
  })

  it('leaves a pull request alone while the org assesses nothing', async () => {
    const { harness, github, settle } = appHarness()
    const reviewId = await opened(harness)
    await settle()
    expect(await assessmentOf(harness, reviewId)).toBeNull()
    expect(github.approvals).toEqual([])
  })
})

describe('assessing and approving unattended', () => {
  it('approves a documentation change the moment it is tracked', async () => {
    const { harness, github, settle } = appHarness()
    expect((await setPolicy(harness, APPROVING)).status).toBe(200)
    const reviewId = await opened(harness)
    await settle()

    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'approved',
      assessor: 'heuristic',
      headSha: 'sha-1',
      changeClass: 'docs',
      verdict: { outcome: 'within_policy', reason: 'class_auto_approve', policyName: 'native' },
      approvedAs: 'sainte-beuve[bot]',
      approvalId: 'approval-1',
    })
    expect(github.approvals).toHaveLength(1)
    expect(github.approvals[0]?.headSha).toBe('sha-1')
    expect(github.approvals[0]?.body).toContain('within the native risk policy')
    expect((await reviewOf(harness, reviewId)).status).toBe('approved')
  })

  it('holds a risky change for a person and approves nothing', async () => {
    const { harness, github, settle } = appHarness()
    github.state.files = RISKY
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await settle()

    const assessment = await assessmentOf(harness, reviewId)
    expect(assessment).toMatchObject({ status: 'requires_review', changeClass: 'schema' })
    expect(assessment?.verdict?.exceededAxes).toContain('risk')
    expect(github.approvals).toEqual([])
    expect((await reviewOf(harness, reviewId)).status).toBe('open')
  })

  it('scores but approves nothing while automatic approval is off', async () => {
    const { harness, github, settle } = appHarness()
    await setPolicy(harness, { ...APPROVING, autoApprove: false })
    const reviewId = await opened(harness)
    await settle()
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'within_policy',
      holdReason: 'automatic approval is off',
    })
    expect(github.approvals).toEqual([])
  })

  it('says so when nobody is configured to approve', async () => {
    const github = host()
    const deferred = collected()
    const harness = buildHarness({ defer: deferred.defer, vcs: environmentVcs(github.gateway) })
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await deferred.settle()
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'within_policy',
      holdReason: 'no approver is configured for GitHub',
    })
    expect(github.approvals).toEqual([])
  })

  it('approves as the token configured for it, rather than as the App', async () => {
    const reader = host()
    const approver = host()
    approver.gateway.identify = async () => ({
      subject: '77',
      username: 'release-bot',
      displayName: null,
      avatarUrl: null,
      bot: true,
    })
    const deferred = collected()
    const harness = buildHarness(
      {
        defer: deferred.defer,
        vcs: environmentVcs(reader.gateway),
        gateways: stubGateways({ vcsFromToken: () => approver.gateway }),
      },
      { encryptionKey: btoa('0123456789abcdef0123456789abcdef') },
    )
    const stored = await harness.app.fetch(
      put('/api/v1/settings/integrations/github-approver-token/token', {
        token: 'ghp_release1234',
      }),
    )
    expect(await stored.json()).toMatchObject({ subject: 'release-bot', inUse: true })
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await deferred.settle()

    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'approved',
      approvedAs: 'release-bot',
    })
    expect(approver.approvals).toHaveLength(1)
    expect(reader.approvals).toEqual([])
  })

  it('never approves a pull request in a repository this org does not hold', async () => {
    const { harness, github, settle } = appHarness()
    await harness.app.fetch(put('/api/v1/settings/risk-policy', APPROVING))
    const reviewId = await opened(harness)
    await settle()
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'within_policy',
      holdReason: 'its repository is not registered to this org',
    })
    expect(github.approvals).toEqual([])
  })

  it('posts the note beside an approval the host carries no text on', async () => {
    const github = host()
    const comments: string[] = []
    github.gateway.approve = async (_pr, input) => {
      github.approvals.push(input)
      return { approvalId: null, bodyPosted: false }
    }
    github.gateway.comment = async (_pr, body) => {
      comments.push(body)
    }
    const { harness, settle } = appHarness(github)
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await settle()
    expect((await assessmentOf(harness, reviewId))?.status).toBe('approved')
    expect(comments).toEqual([expect.stringContaining('within the native risk policy')])
  })

  it('never approves a pull request its approver opened', async () => {
    const { harness, github, settle } = appHarness(host('sainte-beuve[bot]'))
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await settle()
    expect((await assessmentOf(harness, reviewId))?.holdReason).toContain('the approver opened')
    expect(github.approvals).toEqual([])
  })
})

describe('new commits', () => {
  it('withdraw an automatic approval and assess the new head', async () => {
    const { harness, github, settle } = appHarness()
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await settle()
    expect(github.approvals).toHaveLength(1)

    github.state.head = 'sha-2'
    github.state.files = RISKY
    await new ReviewIntake(harness.container).perform({ kind: 'assess', pullRequest: PR })
    await settle()

    expect(github.withdrawals).toEqual([
      { approvalId: 'approval-1', message: expect.stringContaining('withdrawn') },
    ])
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'requires_review',
      headSha: 'sha-2',
      approvalId: null,
    })
    expect((await reviewOf(harness, reviewId)).status).toBe('open')
    expect(github.approvals).toHaveLength(1)
  })

  it('arriving while the approval is being posted take that approval back', async () => {
    const github = host()
    let harness: TestHarness | null = null
    const approve = github.gateway.approve
    github.gateway.approve = async (pr, input) => {
      const approval = await approve(pr, input)
      // The push lands between the host's approval and the row recording it.
      github.state.head = 'sha-2'
      github.state.files = RISKY
      await new ReviewIntake(harness!.container).perform({ kind: 'assess', pullRequest: PR })
      return approval
    }
    const built = appHarness(github)
    harness = built.harness
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await built.settle()

    expect(github.withdrawals).toEqual([
      { approvalId: 'approval-1', message: expect.stringContaining('withdrawn') },
    ])
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'requires_review',
      headSha: 'sha-2',
    })
    expect((await reviewOf(harness, reviewId)).status).toBe('open')
  })

  it('on a pull request the board does not track are not ours', async () => {
    const { harness } = appHarness()
    const outcome = await new ReviewIntake(harness.container).perform({
      kind: 'assess',
      pullRequest: PR,
    })
    expect(outcome.action).toBe('ignored')
  })
})

describe('assessing on request', () => {
  it('assesses a review whatever the policy says about doing it unprompted', async () => {
    const { harness, settle } = appHarness()
    const review = await openReview(harness)
    const res = await harness.app.fetch(post(`/api/v1/reviews/${review.id}/risk-assessment`, {}))
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ status: 'pending' })
    await settle()
    expect(await assessmentOf(harness, review.id)).toMatchObject({ status: 'within_policy' })
  })

  it('refuses a second request while one is in flight', async () => {
    const deferred: Promise<unknown>[] = []
    const { harness } = appHarness(host(), {}, { defer: (work) => void deferred.push(work) })
    const review = await openReview(harness)
    await harness.app.fetch(post(`/api/v1/reviews/${review.id}/risk-assessment`, {}))
    // The first one has not run yet: nothing settled the deferred step.
    await harness.container.repositories.riskAssessments.put({
      ...(await harness.container.repositories.riskAssessments.get(review.id))!,
      status: 'pending',
    })
    const again = await harness.app.fetch(post(`/api/v1/reviews/${review.id}/risk-assessment`, {}))
    expect(again.status).toBe(409)
    await Promise.all(deferred)
  })

  it('lists the assessments of several rows at once', async () => {
    const { harness, settle } = appHarness()
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await settle()
    const res = await harness.app.fetch(get(`/api/v1/risk-assessments?reviewIds=${reviewId},nope`))
    const { assessments } = (await res.json()) as { assessments: RiskAssessment[] }
    expect(assessments.map((row) => row.reviewId)).toEqual([reviewId])
  })
})

describe('the clock', () => {
  it('drives an assessment its own request let go of, after the lease', async () => {
    const dropped: Promise<unknown>[] = []
    const { harness, github } = appHarness(host(), {}, { defer: (work) => void dropped.push(work) })
    await setPolicy(harness, APPROVING)
    const review = await openReview(harness)
    // A queued row whose deferred step never ran, as on a Worker that ended.
    await harness.container.repositories.riskAssessments.put({
      reviewId: review.id,
      pullRequest: review.pullRequest,
      status: 'pending',
      assessor: 'heuristic',
      headSha: null,
      changeClass: null,
      changedFileCount: null,
      scores: null,
      rationale: null,
      verdict: null,
      holdReason: null,
      aiReviewRunId: null,
      aiReviewRating: null,
      approvedAs: null,
      approvalId: null,
      attempts: 0,
      revision: 'queued',
      requestedAt: harness.clock.now(),
      updatedAt: harness.clock.now(),
    })

    expect((await runReminderTick(harness.container)).riskAssessmentsDriven).toBe(0)
    harness.clock.advance(DRIVE_LEASE_MS + 1)
    expect((await runReminderTick(harness.container)).riskAssessmentsDriven).toBe(1)
    expect(github.approvals).toHaveLength(1)
    expect((await assessmentOf(harness, review.id))?.status).toBe('approved')
  })

  it('lets one driver at a row, however many reach it at once', async () => {
    const { harness, github, settle } = appHarness()
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    // The request's own step and a second delivery's, racing on one row.
    await new ReviewIntake(harness.container).perform({ kind: 'assess', pullRequest: PR })
    await settle()
    expect(github.approvals).toHaveLength(1)
    expect((await assessmentOf(harness, reviewId))?.status).toBe('approved')
  })
})

/** A parked review that found the given severities. */
describe('with cat-factory', () => {
  it('approves only once the AI review the policy requires comes back clean', async () => {
    const aiReview = stubAiReview()
    const { harness, github, settle } = await wired({ aiReview: () => aiReview })
    await setPolicy(harness, { ...APPROVING, requireAiReview: true, blockingSeverity: 'medium' })
    const reviewId = await opened(harness)
    await settle()
    expect(await assessmentOf(harness, reviewId)).toMatchObject({ status: 'awaiting_ai_review' })
    expect(aiReview.requested).toHaveLength(1)
    expect(github.approvals).toEqual([])

    aiReview.report = {
      ...aiReview.report,
      status: 'awaiting_selection',
      curation: parkedWith(['low', 'nit']),
    }
    harness.clock.advance(DRIVE_LEASE_MS + 1)
    await runReminderTick(harness.container)

    expect(await assessmentOf(harness, reviewId)).toMatchObject({ status: 'approved' })
    expect(github.approvals[0]?.body).toContain('An AI review rated it 0.95 and found nothing')
    expect(aiReview.resolved).toEqual([
      expect.objectContaining({ action: 'finish', findingIds: [] }),
    ])
  })

  it('leaves the AI review parked for a person when it found something that matters', async () => {
    const aiReview = stubAiReview()
    const { harness, github, settle } = await wired({ aiReview: () => aiReview })
    await setPolicy(harness, { ...APPROVING, requireAiReview: true, blockingSeverity: 'medium' })
    const reviewId = await opened(harness)
    await settle()

    aiReview.report = {
      ...aiReview.report,
      status: 'awaiting_selection',
      curation: parkedWith(['high']),
    }
    harness.clock.advance(DRIVE_LEASE_MS + 1)
    await runReminderTick(harness.container)

    expect(await assessmentOf(harness, reviewId)).toMatchObject({ status: 'requires_review' })
    expect(github.approvals).toEqual([])
    expect(aiReview.resolved).toEqual([])
  })

  it('takes the scores and the verdict from cat-factory, under the policy the org picked', async () => {
    const asked: { policyId: string | null }[] = []
    const external: ExternalRiskAssessment = {
      headSha: 'sha-1',
      changeClass: 'source',
      changedFileCount: 4,
      scores: { complexity: 0.2, risk: 0.15, impact: 0.1 },
      rationale: 'A contained refactor with tests.',
      verdict: {
        outcome: 'within_policy',
        reason: 'within_thresholds',
        exceededAxes: [],
        policyName: 'Balanced',
      },
    }
    const { harness, github, settle } = await wired({
      riskAssessment: () => ({
        assess: async (input) => {
          asked.push({ policyId: input.policyId })
          return external
        },
        listPolicies: async () => [],
      }),
    })
    const saved = await setPolicy(harness, {
      ...APPROVING,
      assessor: 'cat-factory',
      policySource: 'cat-factory',
      catFactoryPolicyId: 'mp_balanced',
    })
    expect(((await saved.json()) as RiskPolicySettings).catFactoryAvailable).toBe(true)
    const reviewId = await opened(harness)
    await settle()

    expect(asked).toEqual([{ policyId: 'mp_balanced' }])
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'approved',
      assessor: 'cat-factory',
      changeClass: 'source',
      verdict: { policyName: 'Balanced' },
    })
    expect(github.approvals[0]?.body).toContain('within the Balanced risk policy')
    // The scores are kept for the pull request too, so every list shows them.
    expect(await harness.container.repositories.pullRequestAssessments.get(PR)).toMatchObject({
      scores: { complexity: 0.2, risk: 0.15, impact: 0.1 },
    })
  })

  it('lists the cat-factory policies for the picker, or says why it cannot', async () => {
    const { harness } = await wired({
      riskAssessment: () => ({
        assess: () => Promise.reject(new Error('unused')),
        listPolicies: () => Promise.reject(new Error('cat-factory refused: needs `admin`')),
      }),
    })
    const res = await harness.app.fetch(get('/api/v1/settings/risk-policy/cat-factory-policies'))
    expect(await res.json()).toEqual({
      policies: [],
      unavailableReason: 'cat-factory refused: needs `admin`',
    })
  })
})
