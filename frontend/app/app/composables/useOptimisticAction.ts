import type { ApiActionOptions } from './useApiAction'

/**
 * Run an action whose outcome the screen can already draw: the change is applied
 * at once, the call goes out behind it, and only a failure is reported, by
 * taking the change back and toasting the API's message with a retry.
 *
 * For the review buttons ("I will review it", "Not me", "Hand back"), whose
 * calls reach the host and can take seconds while the answer is almost always
 * yes. A form whose result the person has to read stays on `useApiAction`.
 *
 * `refresh` runs once nothing is in flight any more, so a burst of clicks
 * re-reads the screen once and a read that started before a call landed cannot
 * draw the row back. A screen whose reads can lag the write (a host search)
 * should keep its own record of what it changed and draw that over the read.
 */
export interface OptimisticAction {
  /** Draw the change, and answer how to take it back. */
  apply: () => () => void
  call: () => Promise<unknown>
  /** The toast's title when the call is refused. */
  failure: string
}

export function useOptimisticAction(options: ApiActionOptions = {}) {
  const { showError } = useErrorToast()
  let inFlight = 0

  function act(action: OptimisticAction): void {
    const undo = action.apply()
    inFlight += 1
    void send(action, undo)
  }

  async function send(action: OptimisticAction, undo: () => void): Promise<void> {
    try {
      await action.call()
      inFlight -= 1
      if (inFlight === 0) await options.refresh?.()
    } catch (err) {
      inFlight -= 1
      undo()
      const describe = options.describe ?? apiErrorMessage
      showError(action.failure, err, describe(err), () => act(action))
    }
  }

  return { act }
}
