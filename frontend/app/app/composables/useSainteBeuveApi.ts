import type { Reviewer, ReviewRequest } from '@sainte-beuve/contracts'

/**
 * The SPA's single door to the backend.
 *
 * One composable rather than `$fetch` at each call site: the base URL comes from
 * runtime config, the error envelope is unwrapped in one place, and a route added
 * to `@sainte-beuve/contracts` has exactly one place to be reached from.
 *
 * PLACEHOLDER: this calls the routes by path today. The contracts already carry
 * the method, path and response schema (`@toad-contracts/valibot`), so the next
 * slice replaces the hand-written paths with `sendByApiContract`, and a response
 * that does not match its contract becomes a client-side error instead of an
 * undefined three components later. See docs/implementation-plan.md, slice 2.
 */
export function useSainteBeuveApi() {
  const apiBase = useRuntimeConfig().public.apiBase

  async function get<T>(path: string): Promise<T> {
    return $fetch<T>(`${apiBase}/api/v1${path}`)
  }

  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return $fetch<T>(`${apiBase}/api/v1${path}`, { method: 'POST', body })
  }

  return {
    apiBase,
    listReviews: () => get<{ reviews: ReviewRequest[] }>('/reviews'),
    listReviewers: () => get<{ reviewers: Reviewer[] }>('/reviewers'),
    assignReviewers: (reviewId: string, count = 1) =>
      post<{ assigned: { reviewerId: string; displayName: string }[] }>(
        `/reviews/${reviewId}/assign`,
        { count },
      ),
    requestAiReview: (reviewId: string, instructions: string | null = null) =>
      post<{ id: string; status: string }>(`/reviews/${reviewId}/ai-review`, { instructions }),
  }
}

/**
 * The operator-facing text for a failed call. The backend answers every fault as
 * `{ error: { code, message } }` and the message names what is missing (which
 * configuration, which review), so it is the thing to show; the transport error is
 * the fallback for a backend that never answered at all.
 */
export function apiErrorMessage(err: unknown): string {
  const envelope = (err as { data?: { error?: { message?: string } } } | null)?.data?.error
  if (envelope?.message) return envelope.message
  return err instanceof Error ? err.message : 'The sainte-beuve API could not be reached'
}
