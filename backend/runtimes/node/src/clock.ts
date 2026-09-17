import { type AppContainer, runReminderTick } from '@sainte-beuve/server'

/**
 * The reminder clock on the Node facade: an interval, with the guarantee an
 * interval does not give.
 */

/**
 * Wrap a pass so it never runs while the last one is still running.
 *
 * `setInterval` fires on the clock whether or not the last callback has
 * finished, and a reminder pass is a batch of outbound calls — Slack for the
 * nudges, one cat-factory per tenancy for the AI-review poll — so a minute that
 * overruns is not exotic. Two passes overlapping is not a slow tick, it is a
 * WRONG one: both read the same reminders as due, and the second sends a nudge
 * the first has already sent and is about to mark sent.
 *
 * SKIPPED rather than queued. The next interval re-reads what is due anyway, so
 * a skipped pass loses nothing, where a queue of late passes would each re-send
 * the batch the one before it is still working through.
 *
 * `pass` is expected to settle rather than reject: a rejection here would escape
 * as an unhandled one, which is why the only caller catches inside it.
 */
export function oneAtATime(pass: () => Promise<void>, onSkip: () => void): () => void {
  let running = false
  return () => {
    if (running) {
      onSkip()
      return
    }
    running = true
    void pass().finally(() => {
      running = false
    })
  }
}

/**
 * The reminder tick, on this process's interval.
 *
 * The Worker needs no equivalent guard: its cron trigger has no local timer to
 * gate, and a flag in one isolate could not gate it if it did.
 */
export function startReminderClock(container: AppContainer, intervalMs: number): NodeJS.Timeout {
  const timer = setInterval(
    oneAtATime(
      async () => {
        try {
          await runReminderTick(container)
        } catch (err: unknown) {
          container.logger.error({ err }, 'reminder tick failed')
        }
      },
      () => {
        container.logger.warn({ intervalMs }, 'reminder tick still running; skipping this interval')
      },
    ),
    intervalMs,
  )
  // Do not hold the process open for the clock alone: a shutdown should be decided
  // by the HTTP server closing, not by a timer nobody is waiting on.
  timer.unref()
  return timer
}
