import assert from 'node:assert/strict'
import type { Repositories } from '@sainte-beuve/kernel'
import { isStoredRowError } from '@sainte-beuve/kernel'

/**
 * What a DURABLE store does with a payload already on disk that its contract no
 * longer describes.
 *
 * These cases need more than the ports. Every write path typechecks against the
 * current contract, so the only way to produce the row this is about is to go
 * behind it, which is what the `writeRaw*` hooks are for. A store that cannot be written
 * behind cannot be tested for it either, so this list is separate from
 * `repositoryConformanceCases` and the two durable suites opt into it.
 *
 * The in-memory store is deliberately NOT here. It holds the objects it was given,
 * for the life of one process, so there is no moment at which a payload from an
 * older contract can appear in it: the hazard needs a disk. A case run against it
 * would exercise its own setup hook and nothing else.
 */
export interface StoreHarness {
  readonly repositories: Repositories
  /**
   * Put `payload` in the reviewer table's `data` column AS GIVEN, behind the
   * store's own write path, the way a deployment on an older contract left it.
   */
  writeRawReviewer(id: string, payload: unknown): Promise<void>
  /**
   * Put `payload` in the AI-review-run table's `data` column AS GIVEN, the way a
   * deployment on an older contract left it. The run is written `awaiting_selection`
   * and never polled, which is the state the reminder ladder reads.
   */
  writeRawAiReviewRun(id: string, reviewId: string, payload: unknown): Promise<void>
}

export interface StoredRowCase {
  readonly name: string
  run(harness: StoreHarness): Promise<void>
}

function storedRowCase(name: string, run: (harness: StoreHarness) => Promise<void>): StoredRowCase {
  return { name, run }
}

/**
 * A reviewer payload from before a second host was registered: its `handles` map
 * names `github` and has no `gitlab` key at all.
 *
 * The scenario `vcs.ts` names when it explains why there is a handle per host, and
 * the one the contract carries a default for. `team` and `slackUserId` are present
 * because `reviewerSchema` declares them `v.nullable`, which requires the key and
 * allows the value to be null; a payload missing one of those is not healable and
 * is the third case below.
 */
const OLDER_SHAPE = {
  id: 'r-old',
  displayName: 'Ada',
  handles: { github: 'ada' },
  slackUserId: null,
  team: null,
  skills: ['payments'],
  availability: 'available',
  weight: 1,
  outstandingReviews: 0,
  createdAt: 1_000,
}

/**
 * An AI-review run payload from before the reminder ladder had a rung for a parked
 * review: it has no `parkedAt` key at all.
 *
 * The field the ladder counts the wait from, and payload-only on purpose, which is
 * exactly why it needs a default rather than only a `v.nullable`. Every run
 * delegated before that release is one of these, and the ladder now reads a
 * review's runs on every status write and every send: one row the schema could not
 * parse would 500 the review it is on and silence the clock that would have healed
 * it.
 */
const RUN_BEFORE_PARKED_AT = {
  id: 'run-old',
  reviewId: 'review-1',
  status: 'awaiting_selection',
  catFactoryTaskId: 'cf-task-1',
  catFactoryRunId: 'cf-run-1',
  catFactoryUrl: null,
  summary: null,
  failureReason: null,
  curation: null,
  requestedAt: 1_000,
  lastPolledAt: null,
  completedAt: null,
}

export const storedRowConformanceCases: readonly StoredRowCase[] = [
  storedRowCase('heals a row written before a second host was registered', async (harness) => {
    await harness.writeRawReviewer('r-old', OLDER_SHAPE)

    const read = await harness.repositories.reviewers.getById('r-old')

    // The default exists for exactly this: the row reads as a whole reviewer, with
    // the handle it predates arriving as the null the contract declares rather than
    // as an `undefined` behind a type promising `string | null`.
    assert.strictEqual(read?.displayName, 'Ada')
    assert.strictEqual(read?.handles.github, 'ada')
    assert.strictEqual(read?.handles.gitlab, null)
  }),

  storedRowCase('heals such a row in a list read too, not only a point read', async (harness) => {
    await harness.writeRawReviewer('r-old', OLDER_SHAPE)

    const [read] = await harness.repositories.reviewers.list()

    assert.strictEqual(read?.handles.gitlab, null)
  }),

  storedRowCase('heals a run written before the park was timestamped', async (harness) => {
    await harness.writeRawAiReviewRun('run-old', 'review-1', RUN_BEFORE_PARKED_AT)

    const read = await harness.repositories.aiReviewRuns.getById('run-old')

    assert.strictEqual(read?.status, 'awaiting_selection')
    assert.strictEqual(read?.parkedAt, null)
  }),

  storedRowCase('heals such a run on the reads the reminder ladder makes', async (harness) => {
    // The two the ladder and the clock go through. A default that only healed a
    // point read would still 500 the board and stop the sweep, which is the pass
    // that would have written a `parkedAt` and healed the row for good.
    await harness.writeRawAiReviewRun('run-old', 'review-1', RUN_BEFORE_PARKED_AT)

    const byReview = await harness.repositories.aiReviewRuns.listByReview('review-1')
    const inFlight = await harness.repositories.aiReviewRuns.listInFlight(10)

    assert.strictEqual(byReview[0]?.parkedAt, null)
    assert.strictEqual(inFlight[0]?.parkedAt, null)
  }),

  storedRowCase('names the table and the row it cannot read', async (harness) => {
    // Not healable: `displayName` has no default, so there is nothing to fall back
    // to and the store must say which row rather than hand the shape onward.
    await harness.writeRawReviewer('r-broken', { id: 'r-broken', weight: 1 })

    const failure = await harness.repositories.reviewers
      .getById('r-broken')
      .then(() => null)
      .catch((err: unknown) => err)

    assert.ok(isStoredRowError(failure), 'expected a StoredRowError')
    assert.strictEqual(failure.table, 'reviewers')
    assert.strictEqual(failure.rowId, 'r-broken')
    assert.ok(failure.message.includes('displayName'), failure.message)
  }),
]
