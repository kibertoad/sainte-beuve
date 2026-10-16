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
  /** What the toast says about a refusal. Defaults to the API's own message. */
  describe?: (err: unknown) => string
}

export function useApiAction(options: ApiActionOptions = {}) {
  const { showError } = useErrorToast()
  const prompt = usePersonalRoutePrompt()
  /** Which key is mid-flight, for a per-row spinner. Null when nothing is. */
  const busy = ref<string | null>(null)

  async function run(
    action: () => Promise<unknown>,
    failure: string,
    key: string | null = null,
  ): Promise<boolean> {
    busy.value = key
    try {
      return await attempt(action, failure, key)
    } finally {
      busy.value = null
    }
  }

  /**
   * One try. A refusal the person fixes in the personal-route prompt is tried
   * again inside the same `run`, so the caller's own handling of the answer
   * still runs on the retry that worked.
   */
  async function attempt(
    action: () => Promise<unknown>,
    failure: string,
    key: string | null,
  ): Promise<boolean> {
    try {
      await action()
      await options.refresh?.()
      return true
    } catch (err) {
      const supplied = prompt.supply(err)
      if (supplied !== null) return (await supplied) && attempt(action, failure, key)
      const retry = () => void run(action, failure, key)
      showError(failure, err, (options.describe ?? apiErrorMessage)(err), retry)
      return false
    }
  }

  return { busy, run }
}
