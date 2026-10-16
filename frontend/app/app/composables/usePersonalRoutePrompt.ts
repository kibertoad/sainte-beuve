import type { PersonalRouteNeed } from '@sainte-beuve/contracts'
import { personalRouteOf } from '@sainte-beuve/contracts'
import { forgetPersonalPassword } from '../utils/personalPassword'
import { ApiError } from '../utils/sainteBeuveApi'

/** What the prompt is open for: what the person has to supply, and the call to make again after. */
export interface PersonalRoutePrompt {
  need: Exclude<PersonalRouteNeed, 'retry'>
  vendor: string | null
  retry: (() => void) | null
}

/**
 * The prompt for a review that runs on the person's own model subscription.
 *
 * `takeOver` is what an error handler asks first: a refusal the person can fix
 * with their own credential opens the prompt instead of an error toast, and one
 * that only needs the same call again makes it. The server refuses these before
 * reaching cat-factory, so nothing is filed twice.
 */
export function usePersonalRoutePrompt() {
  const pending = useState<PersonalRoutePrompt | null>('personal-route-prompt', () => null)
  const apiBase = useRuntimeConfig().public.apiBase

  function takeOver(err: unknown, retry?: () => void): boolean {
    if (!(err instanceof ApiError)) return false
    const route = personalRouteOf(err.details)
    if (route === null) return false
    if (route.need === 'retry') {
      if (retry === undefined) return false
      retry()
      return true
    }
    if (route.need === 'wrong_password') forgetPersonalPassword(apiBase)
    pending.value = { need: route.need, vendor: route.vendor, retry: retry ?? null }
    return true
  }

  function close(): void {
    pending.value = null
  }

  return { pending, takeOver, close }
}
