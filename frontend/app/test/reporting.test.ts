import type { Hotspot, PersonReport } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  hotspotSummary,
  orderPeople,
  type PeopleOrder,
  personName,
  sampleLabel,
} from '../app/utils/reporting'

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

describe('orderPeople', () => {
  const stats = (medianMs: number | null) => ({
    reached: medianMs === null ? 0 : 1,
    waiting: 0,
    medianMs,
    p90Ms: medianMs,
    meanMs: medianMs,
  })
  function person(login: string, fields: Partial<PersonReport>, waitMs: number | null = null) {
    return {
      provider: 'github' as const,
      login,
      reviewerId: null,
      displayName: null,
      reviewed: 0,
      approved: 0,
      firstToReview: 0,
      authored: 0,
      authoredMetrics: {
        first_review: stats(waitMs),
        first_human_review: stats(waitMs),
        approval: stats(null),
        merge: stats(null),
      },
      ...fields,
    }
  }
  const people = [
    person('ada', { reviewed: 5, authored: 1, displayName: 'Ada Lovelace' }, HOUR),
    person('bob', { reviewed: 1, authored: 4 }, 3 * DAY),
    person('cy', { reviewed: 1, authored: 2 }),
  ]

  it('orders by reviews, by pull requests opened, or by the longest wait', () => {
    const logins = (order: PeopleOrder) => orderPeople(people, order).map((entry) => entry.login)
    expect(logins('reviewed')).toEqual(['ada', 'bob', 'cy'])
    expect(logins('authored')).toEqual(['bob', 'cy', 'ada'])
    expect(logins('wait')).toEqual(['bob', 'ada', 'cy'])
  })

  it('finds a person by name or handle, and names them by the directory first', () => {
    expect(orderPeople(people, 'reviewed', 'lovelace').map((entry) => entry.login)).toEqual(['ada'])
    expect(personName(people[0]!)).toBe('Ada Lovelace')
    expect(personName(people[1]!)).toBe('bob')
  })
})
