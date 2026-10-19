/**
 * A read's answer together with what it was asked about.
 *
 * `useAsyncData` with a reactive key keeps the previous key's data on screen
 * while the new key loads, so a page that tests `data === undefined` for
 * "loading" draws the last subject's answer, or its empty state, as this one's.
 * Tagging the answer lets the page tell the two apart.
 */
export interface AnsweredFor<T> {
  subject: string
  value: T
}

/** The answer when it is about `subject`, undefined while that one is still loading. */
export function answerFor<T>(answered: AnsweredFor<T> | undefined, subject: string): T | undefined {
  return answered?.subject === subject ? answered.value : undefined
}
