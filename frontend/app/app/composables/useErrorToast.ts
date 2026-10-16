/**
 * How long an error toast stays up, unless dismissed: long enough to read the
 * message, and to click a fix it offers.
 */
export const ERROR_TOAST_DURATION_MS = 30_000

/**
 * Show a failure as a toast that copies a full report of it when clicked.
 *
 * The toast has room for one sentence; whoever files the ticket needs the route,
 * the status, the refused fields and the page as well. See `errorReport`. A
 * refusal with a fix to offer gets it as buttons (`refusalActions`), with
 * `retry` after it when the caller can run the action again.
 */
export function useErrorToast() {
  const toast = useToast()
  const api = useSainteBeuveApi()

  async function copy(report: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(report)
      toast.add({ color: 'success', title: 'Error details copied' })
    } catch {
      toast.add({
        color: 'error',
        title: 'Could not copy the error details',
        duration: ERROR_TOAST_DURATION_MS,
      })
    }
  }

  function showError(
    title: string,
    err: unknown,
    description = apiErrorMessage(err),
    retry?: () => void,
  ): void {
    const report = errorReport(title, err, {
      page: window.location.href,
      apiBase: api.apiBase || window.location.origin,
      at: new Date(),
      userAgent: navigator.userAgent,
    })
    const actions = refusalActions(err, retry)
    toast.add({
      color: 'error',
      icon: 'i-lucide-clipboard-copy',
      title,
      description,
      onClick: () => void copy(report),
      actions,
      duration: ERROR_TOAST_DURATION_MS,
    })
  }

  return { showError }
}
