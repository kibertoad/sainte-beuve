import { ConflictError } from './errors.js'

/**
 * How many times a compare-and-set write re-reads after losing a race before it
 * gives up. Answers land a few at a time on one row, so a fifth loss in a row
 * means something is writing in a loop, not that the row is busy.
 */
export const MAX_REVISION_ATTEMPTS = 5

/** A row as a compare-and-set store reads it: the value, and the revision it was read at. */
export interface Revisioned<T> {
  value: T
  revision: number
}

export interface RevisionedWrite<T> {
  read(): Promise<Revisioned<T> | null>
  /** Write `next` only if the row is still at `expected`. False when another write got there first. */
  writeIf(next: T, expected: number): Promise<boolean>
  /** The change to apply, as a function of the value as stored. Null leaves the row alone. */
  change(current: T): T | null
  /** Names the row in the conflict raised when every attempt lost. */
  describe: string
}

/**
 * Read, change, and write only if nobody wrote in between; on a lost race, read
 * again and change again. `change` therefore runs once per attempt and must
 * depend on nothing but the value it is given. Answers null when the row does
 * not exist.
 */
export async function writeAtRevision<T>(write: RevisionedWrite<T>): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
    const current = await write.read()
    if (current === null) return null
    const next = write.change(current.value)
    if (next === null) return current.value
    if (await write.writeIf(next, current.revision)) return next
  }
  throw new ConflictError(`${write.describe} kept changing while it was being written`, {
    attempts: MAX_REVISION_ATTEMPTS,
  })
}
