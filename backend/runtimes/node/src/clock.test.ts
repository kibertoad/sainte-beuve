import { describe, expect, it } from 'vitest'
import { oneAtATime } from './clock.js'

/**
 * The guard the Node clock adds over a bare `setInterval`. Tested here rather
 * than through a running server because what is worth pinning is the control
 * flow, and a real pass would need a store, a chat gateway and a wall clock to
 * say nothing more than this does.
 */

/** A pass a case finishes by hand, so nothing depends on timer resolution. */
function pending(): { pass: () => Promise<void>; started: () => number; finish: () => void } {
  let started = 0
  let resolvePass = (): void => {}
  return {
    pass: async () => {
      started += 1
      await new Promise<void>((resolve) => {
        resolvePass = resolve
      })
    },
    started: () => started,
    finish: () => resolvePass(),
  }
}

/** Let the `finally` that clears the flag run before the next fire. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('one pass at a time', () => {
  it('skips a fire that lands while the last pass is still running', async () => {
    let skipped = 0
    const run = pending()
    const tick = oneAtATime(run.pass, () => {
      skipped += 1
    })

    tick()
    tick()
    tick()

    expect(run.started()).toBe(1)
    expect(skipped).toBe(2)
  })

  it('accepts the next fire once the pass has finished, and reports no skip', async () => {
    let skipped = 0
    const run = pending()
    const tick = oneAtATime(run.pass, () => {
      skipped += 1
    })

    tick()
    run.finish()
    await settle()
    tick()

    expect(run.started()).toBe(2)
    expect(skipped).toBe(0)
  })
})
