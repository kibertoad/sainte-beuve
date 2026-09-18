import type { AttentionRequest } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { createAttentionLedger } from '../app/utils/attentionOrder'

// The rule that keeps two events which raced each other on the way to this page
// from landing in the wrong order. The failure it exists for is one-way: an ask
// somebody has answered goes back on the board, and there is no next event and
// no next fetch to take it off again.

const STAMP = 1_700_000_000_000

/** Only the fields the ledger reads. The board row carries the rest. */
function row(fields: Partial<AttentionRequest> = {}): AttentionRequest {
  return { id: 'ask-1', updatedAt: STAMP, status: 'open', ...fields } as AttentionRequest
}

describe('createAttentionLedger', () => {
  it('knows nothing about a request it has not seen', () => {
    expect(createAttentionLedger().isStale(row())).toBe(false)
  })

  it('drops a row older than the one already applied', () => {
    const ledger = createAttentionLedger()
    ledger.remember(row({ updatedAt: STAMP + 100, status: 'resolved' }))

    expect(ledger.isStale(row({ updatedAt: STAMP }))).toBe(true)
  })

  it('keeps a row newer than the one already applied', () => {
    const ledger = createAttentionLedger()
    ledger.remember(row({ updatedAt: STAMP }))

    expect(ledger.isStale(row({ updatedAt: STAMP + 1, status: 'resolved' }))).toBe(false)
  })

  it('applies the same row twice, because a refetch and an event overlap by design', () => {
    // The event that raced a refresh is applied live AND again on top of the
    // list the fetch returned. Calling the second one stale would leave the
    // fetch's older list standing, which is the bug the replay exists to avoid.
    const ledger = createAttentionLedger()
    ledger.remember(row({ status: 'resolved' }))

    expect(ledger.isStale(row({ status: 'resolved' }))).toBe(false)
  })

  it('never reopens an ask it has seen closed, even in the same millisecond', () => {
    // Two writes CAN land in one millisecond, and of the two orders only one is
    // allowed to be wrong.
    const ledger = createAttentionLedger()
    ledger.remember(row({ status: 'resolved' }))

    expect(ledger.isStale(row({ status: 'open' }))).toBe(true)
  })

  it('does not let a stale row become the one it compares against', () => {
    const ledger = createAttentionLedger()
    ledger.remember(row({ updatedAt: STAMP + 100, status: 'resolved' }))
    ledger.remember(row({ updatedAt: STAMP }))

    expect(ledger.isStale(row({ updatedAt: STAMP + 50 }))).toBe(true)
  })

  it('keeps each request apart from the others', () => {
    const ledger = createAttentionLedger()
    ledger.remember(row({ id: 'ask-1', updatedAt: STAMP + 100 }))

    expect(ledger.isStale(row({ id: 'ask-2', updatedAt: STAMP }))).toBe(false)
  })

  it('forgets the oldest ids rather than growing without a bound', () => {
    // A page left open for a week must not hold every ask the org ever raised.
    // What it drops is what nothing has mentioned for longest, which is far
    // outside the window an event can be reordered within.
    const ledger = createAttentionLedger()
    ledger.remember(row({ id: 'ask-old', updatedAt: STAMP + 100, status: 'resolved' }))
    for (let index = 0; index < 500; index++) {
      ledger.remember(row({ id: `ask-${index}`, updatedAt: STAMP }))
    }

    expect(ledger.isStale(row({ id: 'ask-old', updatedAt: STAMP }))).toBe(false)
    expect(ledger.isStale(row({ id: 'ask-499', updatedAt: STAMP - 1 }))).toBe(true)
  })
})
