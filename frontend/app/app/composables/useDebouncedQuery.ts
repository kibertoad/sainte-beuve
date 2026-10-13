export interface DebouncedQueryOptions {
  /** How long the query has to stay unchanged before it is asked. */
  debounceMs: number
  /** Keep the previous answer on screen while the next one loads, instead of clearing it. */
  keepStale?: boolean
}

/**
 * The answer to the latest query, asked once the query has stopped changing.
 * A null query asks nothing and clears the answer.
 *
 * An answer is kept only if the query did not change after it was asked for.
 * Without that, a slow reply to an earlier query landing after a fast one to the
 * current query would replace the right answer with the wrong one.
 */
export function useDebouncedQuery<Query, Answer>(
  query: () => Query | null,
  ask: (query: Query) => Promise<Answer>,
  options: DebouncedQueryOptions,
) {
  const result = ref<Answer | null>(null) as Ref<Answer | null>
  const pending = ref(false)
  const failure = ref<string | null>(null)
  let latest = 0

  watch(
    query,
    (current, _previous, onCleanup) => {
      const ticket = ++latest
      failure.value = null
      if (current === null || options.keepStale !== true) result.value = null
      pending.value = current !== null
      if (current === null) return

      const timer = setTimeout(async () => {
        try {
          const answer = await ask(current)
          if (ticket === latest) result.value = answer
        } catch (err) {
          if (ticket === latest) {
            result.value = null
            failure.value = apiErrorMessage(err)
          }
        } finally {
          if (ticket === latest) pending.value = false
        }
      }, options.debounceMs)
      onCleanup(() => clearTimeout(timer))
    },
    { immediate: true, deep: true },
  )

  return { result, pending, failure }
}
