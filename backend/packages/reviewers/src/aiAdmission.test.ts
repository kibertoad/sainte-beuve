import { describe, expect, it } from 'vitest'
import {
  AI_REVIEW_FILING_TIMEOUT_MS,
  AI_REVIEW_HOURLY_LIMIT,
  type AdmissionRun,
  decideAiReviewAdmission,
} from './aiAdmission.js'

const NOW = 1_700_000_000_000
const MINUTE = 60_000

function run(overrides: Partial<AdmissionRun> = {}): AdmissionRun {
  return {
    status: 'completed',
    catFactoryTaskId: 'task-1',
    requestedAt: NOW - MINUTE,
    ...overrides,
  }
}

describe('decideAiReviewAdmission', () => {
  it('admits the first run on a review', () => {
    expect(decideAiReviewAdmission([], NOW)).toStrictEqual({ admitted: true })
  })

  it('refuses a second run while one is still in flight, parked ones included', () => {
    for (const status of ['requested', 'running', 'awaiting_selection'] as const) {
      expect(decideAiReviewAdmission([run({ status })], NOW)).toStrictEqual({
        admitted: false,
        reason: 'in_flight',
      })
    }
  })

  it('does not let a run that never heard back block the review for good', () => {
    const young = run({ status: 'requested', catFactoryTaskId: null })
    const stuck = run({
      status: 'requested',
      catFactoryTaskId: null,
      requestedAt: NOW - AI_REVIEW_FILING_TIMEOUT_MS,
    })
    expect(decideAiReviewAdmission([young], NOW)).toMatchObject({ admitted: false })
    expect(decideAiReviewAdmission([stuck], NOW)).toStrictEqual({ admitted: true })
  })

  it('caps the runs filed in an hour, and says when the next one may go', () => {
    const filed = Array.from({ length: AI_REVIEW_HOURLY_LIMIT }, (_, index) =>
      run({ requestedAt: NOW - (50 - index * 10) * MINUTE }),
    )
    expect(decideAiReviewAdmission(filed, NOW)).toStrictEqual({
      admitted: false,
      reason: 'hourly_limit',
      retryAt: NOW + 10 * MINUTE,
    })
    expect(decideAiReviewAdmission(filed, NOW + 10 * MINUTE)).toStrictEqual({ admitted: true })
  })

  it('does not count a run cat-factory refused at the door', () => {
    const refused = Array.from({ length: AI_REVIEW_HOURLY_LIMIT }, () =>
      run({ status: 'failed', catFactoryTaskId: null }),
    )
    expect(decideAiReviewAdmission(refused, NOW)).toStrictEqual({ admitted: true })
  })
})
