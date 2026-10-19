import { describe, expect, it } from 'vitest'
import { planTrackedAutomation, type TrackedEvent } from './automation.js'

function event(overrides: Partial<TrackedEvent> = {}): TrackedEvent {
  return {
    policy: { assess: true, autoAiReview: true },
    created: false,
    ready: true,
    assessment: null,
    ...overrides,
  }
}

describe('planTrackedAutomation', () => {
  it('assesses and reviews a pull request that opened ready', () => {
    expect(planTrackedAutomation(event({ created: true }))).toEqual({
      assess: true,
      aiReview: true,
    })
  })

  it('assesses a newly tracked one that is not ready, and files no review', () => {
    expect(planTrackedAutomation(event({ created: true, ready: false }))).toEqual({
      assess: true,
      aiReview: false,
    })
  })

  it('does neither unless the policy turns it on', () => {
    const policy = { assess: false, autoAiReview: false }
    expect(planTrackedAutomation(event({ created: true, policy }))).toEqual({
      assess: false,
      aiReview: false,
    })
  })

  it('assesses again a held row that left draft', () => {
    for (const status of ['within_policy', 'requires_review', 'failed'] as const) {
      expect(planTrackedAutomation(event({ assessment: { status } })).assess).toBe(true)
    }
  })

  it('leaves an assessment in flight or approved alone', () => {
    for (const status of ['pending', 'awaiting_ai_review', 'approved'] as const) {
      expect(planTrackedAutomation(event({ assessment: { status } })).assess).toBe(false)
    }
  })

  it('does nothing for a row that was tracked already and did not become ready', () => {
    expect(planTrackedAutomation(event({ ready: false }))).toEqual({
      assess: false,
      aiReview: false,
    })
  })
})
