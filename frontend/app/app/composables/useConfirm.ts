/**
 * Ask before doing something that cannot be undone.
 *
 * Five actions on this SPA destroyed something on one unconfirmed click and
 * offered no way back: removing a project dropped its skill vocabulary and
 * stopped the workspace sweep, revoking a key stopped a CI pipeline, clearing a
 * credential took the deployment's host away, and finishing an AI review without
 * posting threw away everything cat-factory had found. Four of them sat in the
 * same button cluster as the thing somebody actually meant to press.
 *
 * A PROMISE rather than a callback prop, so the caller reads top to bottom and
 * the guard cannot be forgotten halfway down a handler:
 *
 * ```ts
 * if (!(await confirm({ title: 'Remove kibertoad/sainte-beuve?', ... }))) return
 * ```
 *
 * The dialog itself is `ConfirmDialog`, mounted once in the shell. This holds
 * only the question and the resolver, because two components rendering their own
 * modal is how two modals end up open at once.
 */
export interface ConfirmRequest {
  /** The question, as a question. */
  title: string
  /** What will be lost, in one sentence. */
  description: string
  /** The verb on the button that goes through with it. */
  confirmLabel: string
}

interface PendingConfirm extends ConfirmRequest {
  settle: (confirmed: boolean) => void
}

export function useConfirm() {
  // `useState`, so the shell's dialog and whichever screen asked are looking at
  // one question. Null when nothing is being asked.
  const pending = useState<PendingConfirm | null>('confirm-request', () => null)

  function confirm(request: ConfirmRequest): Promise<boolean> {
    // A second question while one is open ANSWERS THE FIRST with no. The only
    // way to get here is a click the open dialog was covering, and leaving the
    // first promise pending would leave whatever awaited it stuck for the life
    // of the page.
    pending.value?.settle(false)
    return new Promise<boolean>((resolve) => {
      pending.value = {
        ...request,
        settle: (confirmed) => {
          pending.value = null
          resolve(confirmed)
        },
      }
    })
  }

  return { pending, confirm }
}
