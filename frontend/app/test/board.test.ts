import { describe, expect, it } from 'vitest'
import { dueLabel, dueState, relativeAge } from '../app/utils/board'

const NOW = 1_700_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Only the field the helpers read. The board row carries the rest. */
const due = (dueAt: number | null) => ({ dueAt })

describe('relativeAge', () => {
  it('says it in the one unit a person would use', () => {
    expect(relativeAge(NOW - 3 * DAY, NOW)).toBe('3 days')
    expect(relativeAge(NOW - 2 * HOUR, NOW)).toBe('2 hours')
    expect(relativeAge(NOW - 5 * MINUTE, NOW)).toBe('5 minutes')
  })

  it('does not say "1 days"', () => {
    expect(relativeAge(NOW - DAY, NOW)).toBe('1 day')
    expect(relativeAge(NOW - HOUR, NOW)).toBe('1 hour')
    expect(relativeAge(NOW - MINUTE, NOW)).toBe('1 minute')
  })

  it('rounds DOWN, so a row never claims to be older than it is', () => {
    expect(relativeAge(NOW - (2 * DAY - 1), NOW)).toBe('1 day')
  })

  it('reads a future moment as just now rather than as a negative age', () => {
    // The browser's clock and the API's disagree, and a row saying `-1 hours`
    // is a bug report where `just now` is merely imprecise.
    expect(relativeAge(NOW + HOUR, NOW)).toBe('just now')
    expect(relativeAge(NOW, NOW)).toBe('just now')
  })
})

describe('dueState', () => {
  it('marks a deadline that has passed', () => {
    expect(dueState(due(NOW - 1), NOW)).toBe('overdue')
    expect(dueState(due(NOW), NOW)).toBe('overdue')
  })

  it('marks one inside the next day, and nothing further out', () => {
    expect(dueState(due(NOW + HOUR), NOW)).toBe('due')
    expect(dueState(due(NOW + DAY), NOW)).toBe('due')
    // A badge on every row is a badge nobody reads.
    expect(dueState(due(NOW + DAY + 1), NOW)).toBeNull()
  })

  it('says nothing about a review with no deadline', () => {
    expect(dueState(due(null), NOW)).toBeNull()
  })
})

describe('dueLabel', () => {
  it('says how far past the deadline it is', () => {
    const review = { dueAt: NOW - 2 * DAY } as Parameters<typeof dueLabel>[1]
    expect(dueLabel('overdue', review, NOW)).toBe('2 days overdue')
  })

  it('does not put a number on one that is merely close', () => {
    const review = { dueAt: NOW + HOUR } as Parameters<typeof dueLabel>[1]
    expect(dueLabel('due', review, NOW)).toBe('due within a day')
  })
})
