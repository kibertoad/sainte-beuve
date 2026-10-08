/**
 * Re-read something on an interval while `active` says it can still change,
 * and stop with the component.
 *
 * A tick is never started on top of one still in flight, so a slow upstream
 * stretches the cadence instead of stacking calls. A function interval is read
 * before every wait, so the cadence can follow what is being waited on.
 */
export function usePolling(
  active: () => boolean,
  tick: () => Promise<unknown>,
  intervalMs: number | (() => number) = 4000,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function schedule(): void {
    timer = setTimeout(
      async () => {
        if (active()) await tick().catch(() => undefined)
        if (!stopped) schedule()
      },
      typeof intervalMs === 'function' ? intervalMs() : intervalMs,
    )
  }

  onMounted(schedule)
  onUnmounted(() => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  })
}
