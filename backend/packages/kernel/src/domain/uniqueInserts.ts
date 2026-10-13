import { ConflictError } from './errors.js'
import { MAX_REVISION_ATTEMPTS } from './revisions.js'

export interface UniqueInsert<T> {
  /** Insert unless the unique key is taken (`ON CONFLICT DO NOTHING`). True when this call wrote the row. */
  insert(): Promise<boolean>
  /** The row that holds the unique key now, or null when there is none. */
  read(): Promise<T | null>
  /** Names the row in the conflict raised when every attempt lost. */
  describe: string
}

/** The row that holds a unique key, and whether this call is the one that wrote it. */
export interface Inserted<T> {
  value: T
  created: boolean
}

/**
 * Insert a row, or answer the one that already holds its unique key. The key
 * decides, not a lookup ahead of the write, so two callers racing on one key
 * get one row and exactly one of them is told it created it.
 *
 * A losing insert reads the winner; when the winner is deleted before that
 * read, the insert is tried again.
 */
export async function insertOrRead<T>(value: T, write: UniqueInsert<T>): Promise<Inserted<T>> {
  for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
    if (await write.insert()) return { value, created: true }
    const existing = await write.read()
    if (existing !== null) return { value: existing, created: false }
  }
  throw new ConflictError(`${write.describe} kept changing while it was being written`, {
    attempts: MAX_REVISION_ATTEMPTS,
  })
}
