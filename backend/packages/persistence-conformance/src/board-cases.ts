import assert from 'node:assert/strict'
import { type ConformanceCase, conformanceCase } from './case.js'
import {
  aiReviewRun,
  curation,
  integrationToken,
  pullRequest,
  reminder,
  review,
} from './fixtures.js'

/** The board: reviews, the nudges scheduled against them, and the AI runs. */
export const reviewCases: readonly ConformanceCase[] = [
  conformanceCase('a review comes back with every field it was written with', async (repos) => {
    const written = review('rev-1', { assignedReviewerIds: ['r1', 'r2'], dueAt: 9_000 })
    assert.deepStrictEqual(await repos.reviews.create(written), written)
    assert.deepStrictEqual(await repos.reviews.getById('rev-1'), written)
  }),

  conformanceCase('lists the board newest first, ties on the id', async (repos) => {
    // `rev-4` shares a millisecond with `rev-3`, which is what a webhook batch
    // intaken in one tick looks like. Without the tie-break the board reorders
    // itself between two reads, and nobody can follow a list that does that.
    await repos.reviews.create(review('rev-1', { createdAt: 1_000 }))
    await repos.reviews.create(review('rev-3', { createdAt: 3_000 }))
    await repos.reviews.create(review('rev-2', { createdAt: 2_000 }))
    await repos.reviews.create(review('rev-4', { createdAt: 3_000 }))
    const ids = (await repos.reviews.list()).map((row) => row.id)
    assert.deepStrictEqual(ids, ['rev-4', 'rev-3', 'rev-2', 'rev-1'])
  }),

  conformanceCase('filters the board by status', async (repos) => {
    await repos.reviews.create(review('rev-1', { status: 'open', createdAt: 1_000 }))
    await repos.reviews.create(review('rev-2', { status: 'assigned', createdAt: 2_000 }))
    await repos.reviews.create(review('rev-3', { status: 'closed', createdAt: 3_000 }))
    const ids = (await repos.reviews.list({ status: ['open', 'closed'] })).map((row) => row.id)
    assert.deepStrictEqual(ids, ['rev-3', 'rev-1'])
  }),

  conformanceCase('a filter naming no status matches nothing', async (repos) => {
    await repos.reviews.create(review('rev-1'))
    assert.deepStrictEqual(await repos.reviews.list({ status: [] }), [])
  }),

  conformanceCase('finds the review a pull request already opened', async (repos) => {
    // What keeps a webhook replay from opening a second row for one pull
    // request.
    await repos.reviews.create(
      review('rev-1', { pullRequest: pullRequest({ owner: 'platform', repo: 'api', number: 12 }) }),
    )
    const found = await repos.reviews.getByPullRequest({
      owner: 'platform',
      repo: 'api',
      number: 12,
    })
    assert.strictEqual(found?.id, 'rev-1')
    assert.strictEqual(
      await repos.reviews.getByPullRequest({ owner: 'platform', repo: 'api', number: 13 }),
      null,
    )
  }),

  conformanceCase('a review patch touches the fields it names', async (repos) => {
    await repos.reviews.create(review('rev-1'))
    const updated = await repos.reviews.update('rev-1', {
      status: 'assigned',
      assignedReviewerIds: ['r1'],
      assignedAt: 5_000,
    })
    assert.strictEqual(updated?.status, 'assigned')
    assert.deepStrictEqual(updated?.assignedReviewerIds, ['r1'])
    assert.strictEqual(updated?.title, 'Review rev-1')
    assert.deepStrictEqual((await repos.reviews.list({ status: ['assigned'] })).length, 1)
  }),

  conformanceCase('patching a review that is not there answers null', async (repos) => {
    assert.strictEqual(await repos.reviews.update('nobody', { status: 'closed' }), null)
  }),
]

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

export const aiReviewCases: readonly ConformanceCase[] = [
  conformanceCase('a run comes back with the curation it parked on', async (repos) => {
    const written = aiReviewRun('run-1')
    assert.deepStrictEqual(await repos.aiReviewRuns.create(written), written)
    assert.deepStrictEqual(await repos.aiReviewRuns.getById('run-1'), written)
  }),

  conformanceCase("lists a review's runs newest first, ties on the id", async (repos) => {
    await repos.aiReviewRuns.create(aiReviewRun('run-1', { requestedAt: 1_000 }))
    await repos.aiReviewRuns.create(aiReviewRun('run-2', { requestedAt: 2_000 }))
    await repos.aiReviewRuns.create(aiReviewRun('run-3', { requestedAt: 2_000 }))
    await repos.aiReviewRuns.create(aiReviewRun('run-x', { reviewId: 'review-2' }))
    const ids = (await repos.aiReviewRuns.listByReview('review-1')).map((row) => row.id)
    assert.deepStrictEqual(ids, ['run-3', 'run-2', 'run-1'])
  }),

  conformanceCase('a run patch replaces the curation wholesale', async (repos) => {
    await repos.aiReviewRuns.create(aiReviewRun('run-1'))
    const updated = await repos.aiReviewRuns.update('run-1', {
      status: 'completed',
      curation: curation({ selectedFindingIds: ['finding-1'], postAttempts: 1 }),
    })
    assert.strictEqual(updated?.status, 'completed')
    assert.deepStrictEqual(updated?.curation?.selectedFindingIds, ['finding-1'])
    assert.strictEqual(updated?.curation?.findings.length, 1)
  }),

  conformanceCase('patching a run that is not there answers null', async (repos) => {
    assert.strictEqual(await repos.aiReviewRuns.update('nobody', { status: 'failed' }), null)
  }),

  conformanceCase('in-flight runs come back oldest first, across reviews', async (repos) => {
    await repos.aiReviewRuns.create(
      aiReviewRun('run-parked', { status: 'awaiting_selection', requestedAt: 3_000 }),
    )
    await repos.aiReviewRuns.create(
      aiReviewRun('run-running', { status: 'running', requestedAt: 2_000, reviewId: 'review-2' }),
    )
    await repos.aiReviewRuns.create(
      aiReviewRun('run-filed', { status: 'requested', requestedAt: 1_000 }),
    )
    const ids = (await repos.aiReviewRuns.listInFlight(10)).map((row) => row.id)
    // Nothing has been polled, so `requested_at` is what is left to order by,
    // and the run that has been waiting longest goes first.
    assert.deepStrictEqual(ids, ['run-filed', 'run-running', 'run-parked'])
  }),

  conformanceCase('a run that has been polled goes to the back of the rotation', async (repos) => {
    // The property the clock's batch cap rests on. `run-parked` is the oldest
    // request AND the one state a poll can never end — only a person leaves
    // `awaiting_selection` — so ordered by `requested_at` alone it would hold the
    // head of every capped batch for ever and the two newer runs would never be
    // polled at all. Polled first, it sorts LAST.
    await repos.aiReviewRuns.create(
      aiReviewRun('run-parked', {
        status: 'awaiting_selection',
        requestedAt: 1_000,
        lastPolledAt: 9_000,
      }),
    )
    await repos.aiReviewRuns.create(
      aiReviewRun('run-polled', { status: 'running', requestedAt: 2_000, lastPolledAt: 8_000 }),
    )
    await repos.aiReviewRuns.create(
      aiReviewRun('run-fresh', { status: 'running', requestedAt: 3_000, lastPolledAt: null }),
    )
    const ids = (await repos.aiReviewRuns.listInFlight(10)).map((row) => row.id)
    // A null reading sorts FIRST and not last, which is the one thing the two
    // SQL dialects disagree about by default: a run nobody has polled is the one
    // that most needs polling.
    assert.deepStrictEqual(ids, ['run-fresh', 'run-polled', 'run-parked'])
  }),

  conformanceCase('the rotation survives a poll being recorded', async (repos) => {
    // `last_polled_at` is a column in the durable stores AND a field of the
    // payload. A store that wrote only the payload would go on handing the same
    // run to the clock every tick while the rest of the tenancy waited.
    await repos.aiReviewRuns.create(aiReviewRun('run-a', { status: 'running', requestedAt: 1_000 }))
    await repos.aiReviewRuns.create(aiReviewRun('run-b', { status: 'running', requestedAt: 2_000 }))
    assert.deepStrictEqual(
      (await repos.aiReviewRuns.listInFlight(1)).map((row) => row.id),
      ['run-a'],
    )
    await repos.aiReviewRuns.update('run-a', { lastPolledAt: 5_000 })
    assert.deepStrictEqual(
      (await repos.aiReviewRuns.listInFlight(1)).map((row) => row.id),
      ['run-b'],
    )
  }),

  conformanceCase('a settled run is not in flight', async (repos) => {
    await repos.aiReviewRuns.create(aiReviewRun('run-done', { status: 'completed' }))
    await repos.aiReviewRuns.create(aiReviewRun('run-failed', { status: 'failed' }))
    await repos.aiReviewRuns.create(aiReviewRun('run-gone', { status: 'cancelled' }))
    assert.deepStrictEqual(await repos.aiReviewRuns.listInFlight(10), [])
  }),

  conformanceCase('settling a run takes it out of the in-flight read', async (repos) => {
    // The status is a column in the durable stores AND a field of the payload,
    // so this is what proves an update moves both: a store that wrote only the
    // payload would go on handing a finished run to the clock for ever.
    await repos.aiReviewRuns.create(aiReviewRun('run-1', { status: 'running' }))
    assert.strictEqual((await repos.aiReviewRuns.listInFlight(10)).length, 1)
    await repos.aiReviewRuns.update('run-1', { status: 'completed' })
    assert.deepStrictEqual(await repos.aiReviewRuns.listInFlight(10), [])
  }),

  conformanceCase('the in-flight read stops at its limit', async (repos) => {
    await repos.aiReviewRuns.create(aiReviewRun('run-1', { requestedAt: 1_000 }))
    await repos.aiReviewRuns.create(aiReviewRun('run-2', { requestedAt: 2_000 }))
    await repos.aiReviewRuns.create(aiReviewRun('run-3', { requestedAt: 3_000 }))
    const ids = (await repos.aiReviewRuns.listInFlight(2)).map((row) => row.id)
    assert.deepStrictEqual(ids, ['run-1', 'run-2'])
  }),
]

export const integrationTokenCases: readonly ConformanceCase[] = [
  conformanceCase('a credential is stored once per integration', async (repos) => {
    const first = integrationToken('github', { hint: 'aaaa', updatedAt: 1_000 })
    await repos.integrationTokens.put(first)
    assert.deepStrictEqual(await repos.integrationTokens.get('github'), first)
    const second = integrationToken('github', { hint: 'bbbb', updatedAt: 2_000 })
    await repos.integrationTokens.put(second)
    assert.deepStrictEqual(await repos.integrationTokens.get('github'), second)
    assert.strictEqual((await repos.integrationTokens.list()).length, 1)
  }),

  conformanceCase('a pasted credential names nobody', async (repos) => {
    // Null rather than an empty string: a token somebody pasted carries no
    // subject, and the Configuration screen says so rather than showing a blank
    // account.
    await repos.integrationTokens.put(integrationToken('gitlab', { subject: null }))
    await repos.integrationTokens.put(integrationToken('slack', { subject: 'U42' }))
    assert.strictEqual((await repos.integrationTokens.get('gitlab'))?.subject, null)
    assert.strictEqual((await repos.integrationTokens.get('slack'))?.subject, 'U42')
  }),

  conformanceCase('a credential that is not there reads as null', async (repos) => {
    assert.strictEqual(await repos.integrationTokens.get('github'), null)
    assert.deepStrictEqual(await repos.integrationTokens.list(), [])
  }),

  conformanceCase('deleting a credential leaves the others', async (repos) => {
    // Listed by integration id, not in the order they were entered: the
    // Configuration screen renders this list, and one that reshuffled after a
    // paste would move the row somebody is about to click.
    await repos.integrationTokens.put(integrationToken('slack'))
    await repos.integrationTokens.put(integrationToken('github'))
    await repos.integrationTokens.put(integrationToken('gitlab'))
    const listed = (await repos.integrationTokens.list()).map((row) => row.integrationId)
    assert.deepStrictEqual(listed, ['github', 'gitlab', 'slack'])
    await repos.integrationTokens.delete('github')
    const left = (await repos.integrationTokens.list()).map((row) => row.integrationId)
    assert.deepStrictEqual(left, ['gitlab', 'slack'])
  }),
]
