import { describe, expect, it } from 'vitest'
import { DRIVE_LEASE_MS } from '../src/modules/risk/RiskAssessmentService.js'
import { runReminderTick } from '../src/reminders/tick.js'
import { stubAiReview } from './ai-review-doubles.js'
import {
  APPROVING,
  appHarness,
  assessmentOf,
  opened,
  parkedWith,
  setPolicy,
  wired,
} from './risk-harness.js'

// What the org's policy sets off when a pull request opens as a non-draft or
// leaves draft: an assessment, an AI review, and an approval held to the rating
// that review gives. Every case settles the deferred work before it asserts.

const AUTOMATIC = 'Filed automatically: this pull request just became ready for review'

describe('the automatic AI review', () => {
  it('is filed when a pull request becomes ready, if the org turned it on', async () => {
    const aiReview = stubAiReview()
    const { harness, settle } = await wired({ aiReview: () => aiReview })
    await setPolicy(harness, { autoAiReview: true })
    const reviewId = await opened(harness)
    await settle()

    expect(aiReview.requested).toHaveLength(1)
    expect(aiReview.requested[0]?.instructions).toContain(AUTOMATIC)
    // Independent of the assessment, which the org has not turned on.
    expect(await assessmentOf(harness, reviewId)).toBeNull()
  })

  it('is not filed for a track that is not a new review request, nor while it is off', async () => {
    const aiReview = stubAiReview()
    const { harness, settle } = await wired({ aiReview: () => aiReview })
    await setPolicy(harness, { autoAiReview: true })
    await opened(harness, false)
    await settle()
    expect(aiReview.requested).toEqual([])

    await setPolicy(harness, { autoAiReview: false })
    await opened(harness)
    await settle()
    expect(aiReview.requested).toEqual([])
  })

  it('never fails the delivery when it cannot be filed', async () => {
    const { harness, settle } = appHarness()
    await setPolicy(harness, { autoAiReview: true })
    // No cat-factory on this deployment: the track lands, the refusal is logged.
    expect(await opened(harness)).toEqual(expect.any(String))
    await settle()
  })

  it('is the review the policy waits on, so a pull request is reviewed once', async () => {
    const aiReview = stubAiReview()
    const { harness, github, settle } = await wired({ aiReview: () => aiReview })
    await setPolicy(harness, { ...APPROVING, autoAiReview: true, requireAiReview: true })
    const reviewId = await opened(harness)
    await settle()

    expect(aiReview.requested).toHaveLength(1)
    const [run] = await harness.container.repositories.aiReviewRuns.listByReview(reviewId)
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'awaiting_ai_review',
      aiReviewRunId: run?.id,
    })

    aiReview.report = { ...aiReview.report, status: 'awaiting_selection', curation: parkedWith([]) }
    harness.clock.advance(DRIVE_LEASE_MS + 1)
    await runReminderTick(harness.container)
    await settle()
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'approved',
      aiReviewRating: 1,
    })
    expect(github.approvals).toHaveLength(1)
  })
})

describe('approving on the AI review rating', () => {
  async function reviewedWith(
    severities: Parameters<typeof parkedWith>[0],
    minAiReviewRating: number,
  ) {
    const aiReview = stubAiReview()
    const { harness, github, settle } = await wired({ aiReview: () => aiReview })
    await setPolicy(harness, {
      ...APPROVING,
      requireAiReview: true,
      blockingSeverity: 'high',
      minAiReviewRating,
    })
    const reviewId = await opened(harness)
    await settle()
    aiReview.report = {
      ...aiReview.report,
      status: 'awaiting_selection',
      curation: parkedWith(severities),
    }
    harness.clock.advance(DRIVE_LEASE_MS + 1)
    await runReminderTick(harness.container)
    await settle()
    return { assessment: await assessmentOf(harness, reviewId), github }
  }

  it('approves a review rated at the minimum', async () => {
    const { assessment, github } = await reviewedWith(['medium', 'medium'], 0.8)
    expect(assessment).toMatchObject({ status: 'approved', aiReviewRating: 0.8 })
    expect(github.approvals[0]?.body).toContain('An AI review rated it 0.8')
  })

  it('holds one rated below it for a person, saying so', async () => {
    const { assessment, github } = await reviewedWith(['medium', 'medium', 'medium'], 0.8)
    expect(assessment).toMatchObject({
      status: 'requires_review',
      aiReviewRating: 0.7,
      holdReason: 'the AI review rated it 0.7, below the 0.8 the policy asks for',
    })
    expect(github.approvals).toEqual([])
  })

  it('holds one with a finding at the blocking severity, whatever the minimum', async () => {
    const { assessment } = await reviewedWith(['high'], 0)
    expect(assessment).toMatchObject({
      status: 'requires_review',
      holdReason: 'the AI review found 1 finding at high or worse',
    })
  })
})

describe('assessing a pull request that leaves draft', () => {
  it('assesses again a row the board held while it was a draft, and approves it', async () => {
    const { harness, github, settle } = appHarness()
    github.state.draft = true
    await setPolicy(harness, APPROVING)
    // Tracked while still a draft: by a label, say.
    const reviewId = await opened(harness, false)
    await settle()
    expect(await assessmentOf(harness, reviewId)).toMatchObject({
      status: 'within_policy',
      holdReason: 'the pull request is a draft',
    })

    github.state.draft = false
    await opened(harness)
    await settle()
    expect(await assessmentOf(harness, reviewId)).toMatchObject({ status: 'approved' })
    expect(github.approvals).toHaveLength(1)
  })

  it('leaves an approved one alone', async () => {
    const { harness, github, settle } = appHarness()
    await setPolicy(harness, APPROVING)
    const reviewId = await opened(harness)
    await settle()
    await opened(harness)
    await settle()
    expect(await assessmentOf(harness, reviewId)).toMatchObject({ status: 'approved' })
    expect(github.approvals).toHaveLength(1)
  })
})
