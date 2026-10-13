import { describe, expect, it } from 'vitest'
import { ConflictError } from './errors.js'
import { MAX_REVISION_ATTEMPTS } from './revisions.js'
import { insertOrRead, type UniqueInsert } from './uniqueInserts.js'

/** One unique slot, with a hook that lets another writer land before a read. */
function slot(initial: string | null) {
  const state: { held: string | null; inserts: number } = { held: initial, inserts: 0 }
  const interleave: { beforeRead: (() => void) | null } = { beforeRead: null }
  const write = (value: string): UniqueInsert<string> => ({
    describe: 'Slot',
    insert: async () => {
      state.inserts += 1
      if (state.held !== null) return false
      state.held = value
      return true
    },
    read: async () => {
      interleave.beforeRead?.()
      return state.held
    },
  })
  return { state, interleave, write }
}

describe('insertOrRead', () => {
  it('writes the row when the key is free', async () => {
    const free = slot(null)
    expect(await insertOrRead('mine', free.write('mine'))).toStrictEqual({
      value: 'mine',
      created: true,
    })
    expect(free.state.held).toBe('mine')
  })

  it('answers the row that holds the key, and leaves it alone', async () => {
    const taken = slot('theirs')
    expect(await insertOrRead('mine', taken.write('mine'))).toStrictEqual({
      value: 'theirs',
      created: false,
    })
    expect(taken.state.held).toBe('theirs')
  })

  it('inserts again when the row it lost to is deleted before the read', async () => {
    const taken = slot('theirs')
    taken.interleave.beforeRead = () => {
      taken.interleave.beforeRead = null
      taken.state.held = null
    }
    expect(await insertOrRead('mine', taken.write('mine'))).toStrictEqual({
      value: 'mine',
      created: true,
    })
    expect(taken.state.inserts).toBe(2)
  })

  it('gives up when the key never settles', async () => {
    const churning = slot('theirs')
    churning.interleave.beforeRead = () => {
      churning.state.held = null
    }
    const write: UniqueInsert<string> = {
      ...churning.write('mine'),
      insert: async () => {
        churning.state.inserts += 1
        churning.state.held = 'theirs'
        return false
      },
    }
    await expect(insertOrRead('mine', write)).rejects.toBeInstanceOf(ConflictError)
    expect(churning.state.inserts).toBe(MAX_REVISION_ATTEMPTS)
  })
})
