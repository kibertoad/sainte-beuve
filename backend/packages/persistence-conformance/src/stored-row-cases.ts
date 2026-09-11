import assert from 'node:assert/strict'
import type { Repositories } from '@sainte-beuve/kernel'
import { isStoredRowError } from '@sainte-beuve/kernel'

/**
 * What a DURABLE store does with a payload already on disk that its contract no
 * longer describes.
 *
 * These cases need more than the ports. Every write path typechecks against the
 * current contract, so the only way to produce the row this is about is to go
 * behind it, which is what `writeRawPayload` is for. A store that cannot be written
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
