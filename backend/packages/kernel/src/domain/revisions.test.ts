import { describe, expect, it } from 'vitest'
import { ConflictError } from './errors.js'
import { MAX_REVISION_ATTEMPTS, type RevisionedWrite, writeAtRevision } from './revisions.js'

/** A row held in memory, with a hook that lets another writer land between a read and a write. */
function cell(initial: number) {
  const state = { value: initial, revision: 0 }
  const interleave: { before: (() => void) | null } = { before: null }
  const write = (change: (current: number) => number | null): RevisionedWrite<number> => ({
    describe: 'Counter',
    read: async () => ({ value: state.value, revision: state.revision }),
    writeIf: async (next, expected) => {
      interleave.before?.()
      if (state.revision !== expected) return false
      state.value = next
      state.revision += 1
      return true
    },
    change,
  })
  return { state, interleave, write }
}

describe('writeAtRevision', () => {
  it('writes the change when nobody wrote in between', async () => {
    const counter = cell(1)
    expect(await writeAtRevision(counter.write((n) => n + 1))).toBe(2)
    expect(counter.state).toStrictEqual({ value: 2, revision: 1 })
  })

  it('remakes the change on the value another writer left', async () => {
    const counter = cell(1)
    let raced = false
    counter.interleave.before = () => {
      if (raced) return
      raced = true
      counter.state.value = 10
      counter.state.revision += 1
    }
    const seen: number[] = []
    const result = await writeAtRevision(
      counter.write((n) => {
        seen.push(n)
        return n + 1
      }),
    )
    expect(seen).toStrictEqual([1, 10])
    expect(result).toBe(11)
  })

  it('leaves the row alone when the change answers null', async () => {
    const counter = cell(5)
    expect(await writeAtRevision(counter.write(() => null))).toBe(5)
    expect(counter.state.revision).toBe(0)
  })

  it('answers null for a row that is not there', async () => {
    const missing: RevisionedWrite<number> = {
      describe: 'Nothing',
      read: async () => null,
      writeIf: async () => true,
      change: (n) => n,
    }
    expect(await writeAtRevision(missing)).toBeNull()
  })

  it('gives up with a conflict when every attempt loses', async () => {
    const counter = cell(0)
    counter.interleave.before = () => {
      counter.state.revision += 1
    }
    let attempts = 0
    const losing = writeAtRevision(
      counter.write((n) => {
        attempts += 1
        return n + 1
      }),
    )
    await expect(losing).rejects.toBeInstanceOf(ConflictError)
    expect(attempts).toBe(MAX_REVISION_ATTEMPTS)
  })
})
