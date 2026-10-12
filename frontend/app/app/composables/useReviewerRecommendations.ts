import type { PullRequestRef, ReviewerRecommendations } from '@sainte-beuve/contracts'

/** How long the skill choice has to settle before the ranking is asked again. */
const DEBOUNCE_MS = 250

/**
 * The reviewers who fit a pull request best, re-read whenever the pull request
 * or the chosen skills change.
 *
 * An answer is kept only if nothing changed after it was asked for, so a slow
 * reply for an earlier skill choice never replaces the ranking for the current
 * one.
 */
export function useReviewerRecommendations(
  pullRequest: Readonly<Ref<PullRequestRef | null>>,
  requiredSkills: Readonly<Ref<string[]>>,
) {
  const api = useSainteBeuveApi()
  const result = ref<ReviewerRecommendations | null>(null)
  const pending = ref(false)
  const failure = ref<string | null>(null)
  let latest = 0

  watch(
    [pullRequest, requiredSkills],
    ([target, skills], _previous, onCleanup) => {
      const ticket = ++latest
      result.value = null
      failure.value = null
      pending.value = target !== null
      if (target === null) return

      const timer = setTimeout(async () => {
        try {
          const answer = await api.recommendReviewers({
            pullRequest: target,
            requiredSkills: [...skills],
            limit: 5,
          })
          if (ticket === latest) result.value = answer
        } catch (err) {
          if (ticket === latest) failure.value = apiErrorMessage(err)
        } finally {
          if (ticket === latest) pending.value = false
        }
      }, DEBOUNCE_MS)
      onCleanup(() => clearTimeout(timer))
    },
    { immediate: true, deep: true },
  )

  return { result, pending, failure }
}
