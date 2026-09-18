import assert from 'node:assert/strict'
import { type ConformanceCase, conformanceCase } from './case.js'
import { reminder } from './fixtures.js'

/**
 * The reminder ladder as the stores hold it: what is due, what a sender has
 * taken, and the claims nobody finished.
 *
 * Split out of `board-cases.ts` for a size budget rather than a boundary — the
 * rows live on the same table and the tick reads them beside the reviews.
 */
export const reminderCases: readonly ConformanceCase[] = [
  conformanceCase("lists one review's reminders, soonest first", async (repos) => {
    // Nobody else's, and in the order the cadence was planned in: a schedule
    // shown out of order reads as a nudge that has already been missed.
    await repos.reminders.create(reminder('rem-1', { reviewId: 'rev-1', dueAt: 2_000 }))
    await repos.reminders.create(reminder('rem-2', { reviewId: 'rev-2' }))
    await repos.reminders.create(reminder('rem-3', { reviewId: 'rev-1', dueAt: 1_000 }))
    const ids = (await repos.reminders.listByReview('rev-1')).map((row) => row.id)
    assert.deepStrictEqual(ids, ['rem-3', 'rem-1'])
  }),

  conformanceCase('what is due is scheduled, past its time, and oldest first', async (repos) => {
    // Two nudges due in the same millisecond are ordered by id, so the tick
    // takes the same batch twice rather than a different half each time.
    await repos.reminders.create(reminder('rem-late', { dueAt: 5_000 }))
    await repos.reminders.create(reminder('rem-early', { dueAt: 1_000 }))
    await repos.reminders.create(reminder('rem-early-2', { dueAt: 1_000 }))
    await repos.reminders.create(reminder('rem-future', { dueAt: 50_000 }))
    await repos.reminders.create(reminder('rem-sent', { dueAt: 1_000, status: 'sent' }))
    const due = await repos.reminders.listDue(10_000, 10)
    assert.deepStrictEqual(
      due.map((row) => row.id),
      ['rem-early', 'rem-early-2', 'rem-late'],
    )
  }),

  conformanceCase('the tick takes no more than it asked for', async (repos) => {
    await repos.reminders.create(reminder('rem-1', { dueAt: 1_000 }))
    await repos.reminders.create(reminder('rem-2', { dueAt: 2_000 }))
    await repos.reminders.create(reminder('rem-3', { dueAt: 3_000 }))
    const due = await repos.reminders.listDue(10_000, 2)
    assert.deepStrictEqual(
      due.map((row) => row.id),
      ['rem-1', 'rem-2'],
    )
  }),

  conformanceCase('a delivery records what it was told and keeps the rest', async (repos) => {
    await repos.reminders.create(reminder('rem-1'))
    await repos.reminders.updateStatus('rem-1', 'sent', { sentAt: 7_000 })
    // A retry that failed must not lose the time the first attempt went out.
    await repos.reminders.updateStatus('rem-1', 'failed', { failureReason: 'channel_not_found' })
    const [stored] = await repos.reminders.listByReview('review-1')
    assert.strictEqual(stored?.status, 'failed')
    assert.strictEqual(stored?.sentAt, 7_000)
    assert.strictEqual(stored?.failureReason, 'channel_not_found')
  }),

  conformanceCase('a delivery against a reminder that is gone does nothing', async (repos) => {
    await repos.reminders.updateStatus('nobody', 'sent', { sentAt: 1 })
    assert.deepStrictEqual(await repos.reminders.listByReview('review-1'), [])
  }),

  conformanceCase('a nudge is claimed once, and the second pass gets nothing', async (repos) => {
    // What stops two senders posting the same nudge: `listDue` is a read, and a
    // deployment with two replicas — or a cron firing while the last invocation
    // is still finishing — has two passes over the same batch.
    await repos.reminders.create(reminder('rem-1'))
    const [due] = await repos.reminders.listDue(10_000, 10)
    assert.ok(due !== undefined)
    assert.strictEqual(await repos.reminders.claim(due, 9_000), true)
    assert.strictEqual(await repos.reminders.claim(due, 9_500), false)
    const [stored] = await repos.reminders.listByReview('review-1')
    // The column AND the payload moved, or the next read reports a nudge as
    // still scheduled and the tick takes it again.
    assert.strictEqual(stored?.status, 'sending')
    // The claim is stamped, which is what makes it a lease rather than a
    // permanent take: a sender that dies leaves this behind to be aged.
    assert.strictEqual(stored?.claimedAt, 9_000)
    // A claimed nudge is out of the due set, which is what the guard is for.
    assert.deepStrictEqual(await repos.reminders.listDue(10_000, 10), [])
    // And it is still a nudge: what was claimed keeps everything else it carried.
    assert.strictEqual(stored?.kind, due.kind)
    assert.strictEqual(stored?.dueAt, due.dueAt)
  }),

  conformanceCase('a claim nobody finished is findable once it is old', async (repos) => {
    // What stops a dead sender ending a review's ladder. `listDue` reads
    // `scheduled` only, so without this read the row below is invisible to
    // every later pass and the review is never chased again.
    await repos.reminders.create(reminder('rem-stuck'))
    const [due] = await repos.reminders.listDue(10_000, 10)
    assert.ok(due !== undefined)
    assert.strictEqual(await repos.reminders.claim(due, 9_000), true)
    // Not yet: a claim younger than the lease is a send that may be in flight.
    assert.deepStrictEqual(await repos.reminders.listStalledClaims(9_000, 10), [])
    const stalled = await repos.reminders.listStalledClaims(9_001, 10)
    assert.deepStrictEqual(
      stalled.map((row) => row.id),
      ['rem-stuck'],
    )
    // The whole row comes back, because recovery re-plans from its review.
    assert.strictEqual(stalled[0]?.reviewId, due.reviewId)
  }),

  conformanceCase('the stalled read takes the oldest claims, and only those', async (repos) => {
    // Oldest first and capped, for `listDue`'s reason: a deployment that
    // crash-looped through a batch recovers a slice per tick rather than in one
    // unbounded pass, and what the cap leaves over is taken next tick.
    for (const [id, claimedAt] of [
      ['rem-1', 1_000],
      ['rem-2', 2_000],
      ['rem-3', 3_000],
    ] as const) {
      await repos.reminders.create(reminder(id))
      await repos.reminders.claim(reminder(id), claimedAt)
    }
    // Every other status is somebody else's business: a nudge that settled is
    // not a claim anybody is still holding.
    await repos.reminders.create(reminder('rem-sent', { status: 'sent', claimedAt: 1_000 }))
    await repos.reminders.create(reminder('rem-open', { status: 'scheduled' }))
    const stalled = await repos.reminders.listStalledClaims(9_000, 2)
    assert.deepStrictEqual(
      stalled.map((row) => row.id),
      ['rem-1', 'rem-2'],
    )
  }),

  conformanceCase('a stranded claim is given up on once, and only once', async (repos) => {
    // The guard on the repair, and it matters for the reason the claim itself
    // does: giving up re-plans the review's ladder, which is a cancel and a
    // create, and two passes doing that would leave the review with two
    // scheduled nudges — the duplicate the claim exists to prevent.
    await repos.reminders.create(reminder('rem-1'))
    const [due] = await repos.reminders.listDue(10_000, 10)
    assert.ok(due !== undefined)
    await repos.reminders.claim(due, 1_000)
    const [stranded] = await repos.reminders.listStalledClaims(9_000, 10)
    assert.ok(stranded !== undefined)
    assert.strictEqual(await repos.reminders.abandonClaim(stranded, 'interrupted'), true)
    assert.strictEqual(await repos.reminders.abandonClaim(stranded, 'interrupted'), false)

    const [stored] = await repos.reminders.listByReview('review-1')
    // The column AND the payload moved, and the reason is on the row where an
    // archived channel's would be.
    assert.strictEqual(stored?.status, 'failed')
    assert.strictEqual(stored?.failureReason, 'interrupted')
    // The claim is KEPT: a failure whose claim is minutes older than it is the
    // record of what happened.
    assert.strictEqual(stored?.claimedAt, 1_000)
    // And it is out of the stalled set, which is what the guard is for.
    assert.deepStrictEqual(await repos.reminders.listStalledClaims(9_000, 10), [])
  }),

  conformanceCase('a nudge that is not mid-send cannot be given up on', async (repos) => {
    // A delivery that settled, and a row that is simply gone, answer the same
    // way: not yours to repair.
    await repos.reminders.create(reminder('rem-1', { status: 'sent', sentAt: 5_000 }))
    assert.strictEqual(await repos.reminders.abandonClaim(reminder('rem-1'), 'nope'), false)
    assert.strictEqual(await repos.reminders.abandonClaim(reminder('nobody'), 'nope'), false)
    assert.strictEqual((await repos.reminders.listByReview('review-1'))[0]?.status, 'sent')
  }),

  conformanceCase('a claim with no timestamp is never given up on', async (repos) => {
    // A row written before the claim carried one. It cannot be aged, and a
    // sweep that guessed would give up on a send that is in flight right now —
    // so `claimed_at < ?` drops it, on every store.
    await repos.reminders.create(reminder('rem-old', { status: 'sending', claimedAt: null }))
    assert.deepStrictEqual(await repos.reminders.listStalledClaims(9_000, 10), [])
  }),

  conformanceCase('a nudge that is no longer scheduled cannot be claimed', async (repos) => {
    // A cancelled schedule (the review reached a verdict between the read and
    // the send) and a row that is simply gone answer the same way: not yours.
    await repos.reminders.create(reminder('rem-1', { status: 'cancelled' }))
    assert.strictEqual(await repos.reminders.claim(reminder('rem-1'), 9_000), false)
    assert.strictEqual(await repos.reminders.claim(reminder('nobody'), 9_000), false)
    assert.strictEqual((await repos.reminders.listByReview('review-1'))[0]?.status, 'cancelled')
  }),

  conformanceCase('cancelling a schedule that is not there does nothing', async (repos) => {
    // The common case, not an edge one: this is called before every re-plan, so
    // most calls have nothing to cancel. A store that writes its cancellations
    // as one batch has to answer an empty one without complaining.
    await repos.reminders.cancelScheduledForReview('rev-nobody')
    assert.deepStrictEqual(await repos.reminders.listByReview('rev-nobody'), [])
  }),

  conformanceCase('a verdict cancels the schedule and nothing else', async (repos) => {
    // `cancelled` is a state rather than a delete: a nudge that became moot
    // should still be visible when the cadence is tuned against what happened.
    await repos.reminders.create(reminder('rem-1', { reviewId: 'rev-1', status: 'scheduled' }))
    await repos.reminders.create(reminder('rem-2', { reviewId: 'rev-1', status: 'sent' }))
    await repos.reminders.create(reminder('rem-3', { reviewId: 'rev-2', status: 'scheduled' }))
    await repos.reminders.cancelScheduledForReview('rev-1')
    const statuses = new Map(
      (await repos.reminders.listByReview('rev-1')).map((row) => [row.id, row.status]),
    )
    assert.strictEqual(statuses.get('rem-1'), 'cancelled')
    assert.strictEqual(statuses.get('rem-2'), 'sent')
    assert.strictEqual((await repos.reminders.listByReview('rev-2'))[0]?.status, 'scheduled')
    const stillDue = (await repos.reminders.listDue(100_000, 10)).map((row) => row.id)
    assert.deepStrictEqual(stillDue, ['rem-3'])
  }),
]
