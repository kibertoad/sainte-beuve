/**
 * Run one action against the API and say what happened.
 *
 * Every screen's buttons want the same three things: which row is mid-flight, a
 * refresh once the call lands, and the API's own message in a toast when it
 * refuses. Those refusals are the normal case rather than an exception (503 while
 * an integration is unconfigured, 404 for a review somebody else has closed), and
 * an unhandled rejection would leave the button looking dead.
 *
 * It returns WHETHER the action worked, which is the part a caller cannot get
 * from a promise this already caught: a screen that clears an input on success
 * must not clear it on a failure the operator is about to retry.
 */
export interface ApiActionOptions {
  /** Re-read the screen's data once the action lands, so it reports the new state. */
  refresh?: () => Promise<unknown>
}

export function useApiAction(options: ApiActionOptions = {}) {
  const toast = useToast()
  /** Which key is mid-flight, for a per-row spinner. Null when nothing is. */
  const busy = ref<string | null>(null)

  async function run(
    action: () => Promise<unknown>,
    failure: string,
    key: string | null = null,
  ): Promise<boolean> {
    busy.value = key
    try {
      await action()
      await options.refresh?.()
      return true
    } catch (err) {
      toast.add({ color: 'error', title: failure, description: apiErrorMessage(err) })
      return false
    } finally {
      busy.value = null
    }
  }

  return { busy, run }
}
