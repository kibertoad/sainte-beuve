/**
 * Show a failure as a toast that copies a full report of it when clicked.
 *
 * The toast has room for one sentence; whoever files the ticket needs the route,
 * the status, the refused fields and the page as well. See `errorReport`.
 */
export function useErrorToast() {
  const toast = useToast()
  const api = useSainteBeuveApi()

  async function copy(report: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(report)
      toast.add({ color: 'success', title: 'Error details copied' })
    } catch {
      toast.add({ color: 'error', title: 'Could not copy the error details' })
    }
  }

  function showError(title: string, err: unknown, description = apiErrorMessage(err)): void {
    const report = errorReport(title, err, {
      page: window.location.href,
      apiBase: api.apiBase || window.location.origin,
      at: new Date(),
      userAgent: navigator.userAgent,
    })
    toast.add({
      color: 'error',
      icon: 'i-lucide-clipboard-copy',
      title,
      description,
      onClick: () => void copy(report),
    })
  }

  return { showError }
}
