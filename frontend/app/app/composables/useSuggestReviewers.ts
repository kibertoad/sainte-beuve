import type { MyPullRequest } from '@sainte-beuve/contracts'

/**
 * The "Suggest reviewers" dialog on My PRs: which pull request it is open for,
 * and asking the people picked on it.
 */
export function useSuggestReviewers() {
  const api = useSainteBeuveApi()
  const toast = useToast()
  /** The pull request the dialog is open for. Null when closed. */
  const suggesting = ref<MyPullRequest | null>(null)
  const { busy, run } = useApiAction()

  /** Reviewers are for a pull request still open and out of draft. */
  function offersReviewerSuggestions(pr: MyPullRequest): boolean {
    return !pr.draft && (pr.status === null || pr.status.state === 'open')
  }

  async function askReviewers(request: { reviewerIds: string[]; note: string | null }) {
    const pr = suggesting.value
    if (pr === null) return
    const asked = await run(
      () =>
        api.askSuggestedReviewers({
          pullRequest: pr.pullRequest,
          title: pr.title,
          reviewerIds: request.reviewerIds,
          note: request.note,
        }),
      'Could not ask the reviewers',
      pr.pullRequest.url,
    )
    if (!asked) return
    suggesting.value = null
    toast.add({
      color: 'success',
      title: askedLabel(request.reviewerIds.length),
      description: 'They are notified and asked to commit to reviewing it.',
    })
  }

  return { suggesting, askBusy: busy, offersReviewerSuggestions, askReviewers }
}
