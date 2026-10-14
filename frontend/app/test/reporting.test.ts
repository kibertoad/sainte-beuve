import type { Hotspot } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { formatDuration, hotspotSummary, sampleLabel } from '../app/utils/reporting'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function hotspot(fields: Partial<Hotspot> = {}): Hotspot {
  return {
    projectId: 'p1',
    milestone: 'first_human_review',
    reason: 'slow',
    medianMs: 2 * DAY,
    overallMedianMs: 5 * HOUR,
    overdue: 0,
    ...fields,
  }
}

describe('formatDuration', () => {
  it.each([
    [null, 'n/a'],
    [10_000, '1m'],
    [45 * MINUTE, '45m'],
    [5.5 * HOUR, '5.5h'],
    [3 * HOUR, '3h'],
    [3.24 * DAY, '3.2d'],
    [14.6 * DAY, '15d'],
  ])('reads %s as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

describe('sampleLabel', () => {
  it('names the waiting ones only when there are some', () => {
    const stats = { reached: 4, waiting: 0, medianMs: 1, p90Ms: 1, meanMs: 1 }
    expect(sampleLabel(stats)).toBe('4 reached')
    expect(sampleLabel({ ...stats, waiting: 2 })).toBe('4 reached, 2 waiting')
  })
})

describe('hotspotSummary', () => {
  it('compares a slow median with the whole report', () => {
    expect(hotspotSummary(hotspot())).toBe(
      'Median first human review 2d, against 5h across the report',
    )
  })

  it('counts what a stalled repository has left waiting', () => {
    expect(hotspotSummary(hotspot({ reason: 'stalled', milestone: 'approval', overdue: 3 }))).toBe(
      '3 open pull requests waiting on approval longer than nearly anything else took',
    )
  })
})
