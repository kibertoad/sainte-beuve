import assert from 'node:assert/strict'
import { type ConformanceCase, conformanceCase } from './case.js'
import { aiReviewRun, curation, integrationToken, pullRequest, review } from './fixtures.js'

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

  conformanceCase('a capped board takes the newest rows, not any rows', async (repos) => {
    // The cap has to be applied to the ORDERED read, or a board that asks for
    // twenty shows twenty arbitrary reviews out of everything ever tracked.
    await repos.reviews.create(review('rev-1', { createdAt: 1_000 }))
    await repos.reviews.create(review('rev-2', { createdAt: 2_000 }))
    await repos.reviews.create(review('rev-3', { createdAt: 3_000 }))
    const ids = (await repos.reviews.list({ limit: 2 })).map((row) => row.id)
    assert.deepStrictEqual(ids, ['rev-3', 'rev-2'])
    const open = (await repos.reviews.list({ status: ['open'], limit: 1 })).map((row) => row.id)
    assert.deepStrictEqual(open, ['rev-3'])
  }),

  conformanceCase('a capped board can take the OLDEST rows instead', async (repos) => {
    // What the board actually reads with. The cap and the order are one
    // decision: a queue promising "the ones waiting longest" and capped
    // newest-first drops exactly the rows it promised, and nothing paginates to
    // them. `rev-4` shares a millisecond with `rev-3`, so the tie-break has to
    // turn around with the timestamp or the read stops being total.
    await repos.reviews.create(review('rev-1', { createdAt: 1_000 }))
    await repos.reviews.create(review('rev-3', { createdAt: 3_000 }))
    await repos.reviews.create(review('rev-2', { createdAt: 2_000 }))
    await repos.reviews.create(review('rev-4', { createdAt: 3_000 }))
    const ids = (await repos.reviews.list({ order: 'oldest' })).map((row) => row.id)
    assert.deepStrictEqual(ids, ['rev-1', 'rev-2', 'rev-3', 'rev-4'])
    const capped = (await repos.reviews.list({ order: 'oldest', limit: 2 })).map((row) => row.id)
    assert.deepStrictEqual(capped, ['rev-1', 'rev-2'])
  }),

  conformanceCase('finds the review a pull request already opened', async (repos) => {
    // What keeps a webhook replay from opening a second row for one pull
    // request.
    await repos.reviews.create(
      review('rev-1', { pullRequest: pullRequest({ owner: 'platform', repo: 'api', number: 12 }) }),
    )
    const found = await repos.reviews.getByPullRequest({
      provider: 'github',
      owner: 'platform',
      repo: 'api',
      number: 12,
    })
    assert.strictEqual(found?.id, 'rev-1')
    assert.strictEqual(
      await repos.reviews.getByPullRequest({
        provider: 'github',
        owner: 'platform',
        repo: 'api',
        number: 13,
      }),
      null,
    )
  }),

  conformanceCase(
    'a GitHub and a GitLab pull request under one name are two reviews',
    async (repos) => {
      // `platform/api#12` exists on both hosts and they are two different
      // changes, so neither lookup may hand back the other's row.
      const onGitHub = pullRequest({
        provider: 'github',
        owner: 'platform',
        repo: 'api',
        number: 12,
      })
      const onGitLab = pullRequest({
        provider: 'gitlab',
        owner: 'platform',
        repo: 'api',
        number: 12,
        url: 'https://gitlab.com/platform/api/-/merge_requests/12',
      })
      await repos.reviews.create(review('rev-gh', { pullRequest: onGitHub }))
      assert.strictEqual(await repos.reviews.getByPullRequest(onGitLab), null)

      await repos.reviews.create(review('rev-gl', { pullRequest: onGitLab }))
      assert.strictEqual((await repos.reviews.getByPullRequest(onGitHub))?.id, 'rev-gh')
      assert.strictEqual((await repos.reviews.getByPullRequest(onGitLab))?.id, 'rev-gl')

      // A rewrite of one row keeps its host, so the other lookup still misses it.
      await repos.reviews.update('rev-gh', { status: 'assigned' })
      assert.strictEqual((await repos.reviews.getByPullRequest(onGitLab))?.id, 'rev-gl')
    },
  ),

  conformanceCase('a pull request is found whatever the case of its path', async (repos) => {
    // Both hosts treat the path without case, so a webhook's `Platform/API` and
    // a hand-entered `platform/api` are one pull request.
    await repos.reviews.create(
      review('rev-1', { pullRequest: pullRequest({ owner: 'Platform', repo: 'API' }) }),
    )
    const found = await repos.reviews.getByPullRequest({
      provider: 'github',
      owner: 'platform',
      repo: 'api',
      number: 12,
    })
    assert.strictEqual(found?.id, 'rev-1')
    assert.strictEqual(found?.pullRequest.owner, 'Platform')
  }),

  conformanceCase('a list of pull requests finds the reviews tracking them', async (repos) => {
    await repos.reviews.create(review('rev-1', { pullRequest: pullRequest({ number: 1 }) }))
    await repos.reviews.create(review('rev-2', { pullRequest: pullRequest({ number: 2 }) }))
    await repos.reviews.create(review('rev-3', { pullRequest: pullRequest({ number: 3 }) }))
    const found = await repos.reviews.listByPullRequests([
      { provider: 'github', owner: 'Platform', repo: 'api', number: 1 },
      { provider: 'github', owner: 'platform', repo: 'api', number: 3 },
      { provider: 'gitlab', owner: 'platform', repo: 'api', number: 2 },
    ])
    assert.deepStrictEqual(found.map((row) => row.id).sort(), ['rev-1', 'rev-3'])
    assert.deepStrictEqual(await repos.reviews.listByPullRequests([]), [])
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

export const aiReviewCases: readonly ConformanceCase[] = [
  conformanceCase('lists the runs of several reviews at once', async (repos) => {
    await repos.aiReviewRuns.create(aiReviewRun('run-1', { reviewId: 'review-1' }))
    await repos.aiReviewRuns.create(aiReviewRun('run-2', { reviewId: 'review-2' }))
    await repos.aiReviewRuns.create(aiReviewRun('run-3', { reviewId: 'review-3' }))
    const found = await repos.aiReviewRuns.listByReviews(['review-1', 'review-3', 'nobody'])
    assert.deepStrictEqual(found.map((row) => row.id).sort(), ['run-1', 'run-3'])
    assert.deepStrictEqual(await repos.aiReviewRuns.listByReviews([]), [])
  }),

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

  conformanceCase('a credential records whether its account is a bot', async (repos) => {
    await repos.integrationTokens.put(
      integrationToken('gitlab-pat', { subject: 'review-bot', subjectIsBot: true }),
    )
    await repos.integrationTokens.put(integrationToken('github-pat', { subject: 'ada' }))
    assert.strictEqual((await repos.integrationTokens.get('gitlab-pat'))?.subjectIsBot, true)
    assert.strictEqual((await repos.integrationTokens.get('github-pat'))?.subjectIsBot, false)
    // A replacement carries its own answer rather than keeping the old one.
    await repos.integrationTokens.put(integrationToken('gitlab-pat', { subject: 'ada' }))
    assert.strictEqual((await repos.integrationTokens.get('gitlab-pat'))?.subjectIsBot, false)
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
