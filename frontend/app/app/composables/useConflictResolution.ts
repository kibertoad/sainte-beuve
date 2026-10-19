import type { MyPullRequest } from '@sainte-beuve/contracts'
import { formatPullRequestRef } from '@sainte-beuve/contracts'

type RunAction = ReturnType<typeof useApiAction>['run']

/** Handing a conflicting pull request on My PRs to cat-factory to resolve. */
export function useConflictResolution(run: RunAction) {
  const api = useSainteBeuveApi()
  const capabilities = useCapabilities()
  const toast = useToast()

  /**
   * Resolutions requested from this screen, by pull request, with the link to
   * watch each in cat-factory. Nothing stores them, so this is what keeps a second
   * click from filing a second resolver while the first has not pushed yet.
   */
  const resolutions = reactive(new Map<string, string | undefined>())

  function conflicting(pr: MyPullRequest): boolean {
    return pr.status?.mergeability === 'conflicting'
  }

  /**
   * A linked pull request whose branch conflicts with its base, on an org that
   * has cat-factory to hand it to, and not yet handed to it from here.
   */
  function offersConflictResolution(pr: MyPullRequest): boolean {
    return (
      conflicting(pr) &&
      pr.projectId !== null &&
      capabilities.confirmed('aiReview') &&
      !resolutions.has(pr.pullRequest.url)
    )
  }

  function resolving(pr: MyPullRequest): boolean {
    return conflicting(pr) && resolutions.has(pr.pullRequest.url)
  }

  async function resolveConflicts(pr: MyPullRequest) {
    const { projectId } = pr
    if (projectId === null) return
    const key = pr.pullRequest.url
    const started = await run(
      async () => {
        const { url } = await api.resolveConflicts({ projectId, number: pr.pullRequest.number })
        resolutions.set(key, safeHref(url))
      },
      'Could not start resolving the conflicts',
      `${key}:conflicts`,
    )
    if (!started) return
    const link = resolutions.get(key)
    toast.add({
      color: 'success',
      title: 'Resolving conflicts',
      description: `cat-factory will push its resolution to ${formatPullRequestRef(pr.pullRequest)}.`,
      actions: link ? [{ label: 'Watch in cat-factory', to: link, target: '_blank' }] : [],
    })
  }

  return { resolutions, offersConflictResolution, resolving, resolveConflicts }
}
