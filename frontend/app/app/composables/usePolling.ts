/**
 * Re-read something on an interval while `active` says it can still change,
 * and stop with the component.
 *
 * A tick is never started on top of one still in flight, so a slow upstream
 * stretches the cadence instead of stacking calls.
 */
export function usePolling(
  active: () => boolean,
  tick: () => Promise<unknown>,
  intervalMs = 4000,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function schedule(): void {
    timer = setTimeout(async () => {
      if (active()) await tick().catch(() => undefined)
      if (!stopped) schedule()
    }, intervalMs)
  }

  onMounted(schedule)
  onUnmounted(() => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  })
}
