import type { CatFactoryPersonalRoute, PersonalRouteNeed } from '@sainte-beuve/contracts'
import { personalRouteOf } from '@sainte-beuve/contracts'
import { forgetPersonalPassword } from '../utils/personalPassword'
import { ApiError } from '../utils/sainteBeuveApi'

/** What the prompt is open for, and how it settles: true once the person supplied it, false on a cancel. */
export interface PersonalRoutePrompt {
  need: Exclude<PersonalRouteNeed, 'retry'>
  vendor: string | null
  settle: (supplied: boolean) => void
}

function routeOf(err: unknown): CatFactoryPersonalRoute | null {
  return err instanceof ApiError ? personalRouteOf(err.details) : null
}

/**
 * The prompt for a review that runs on the person's own model subscription.
 *
 * A refusal the person can fix with their own credential opens the prompt
 * instead of an error toast, and one that only needs the same call again asks
 * for nothing. The server refuses these before reaching cat-factory, so making
 * the call again files nothing twice.
 */
export function usePersonalRoutePrompt() {
  const pending = useState<PersonalRoutePrompt | null>('personal-route-prompt', () => null)
  const apiBase = useRuntimeConfig().public.apiBase

  function open(route: CatFactoryPersonalRoute): Promise<boolean> {
    if (route.need === 'retry') return Promise.resolve(true)
    if (route.need === 'wrong_password') forgetPersonalPassword(apiBase)
    const { need } = route
    // A prompt still open for an earlier call gives way, and that call is not made again.
    pending.value?.settle(false)
    return new Promise((resolve) => {
      pending.value = { need, vendor: route.vendor, settle: resolve }
    })
  }

  /**
   * Whether `err` is a refusal the person can fix with their own credential.
   * If so, it resolves once they have dealt with the prompt: true when the
   * same call should be made again, false when they cancelled. Null otherwise.
   */
  function supply(err: unknown): Promise<boolean> | null {
    const route = routeOf(err)
    return route === null ? null : open(route)
  }

  /** `supply` for an error handler holding only a callback to make the call again. */
  function takeOver(err: unknown, retry?: () => void): boolean {
    const route = routeOf(err)
    if (route === null || (route.need === 'retry' && retry === undefined)) return false
    void open(route).then((again) => {
      if (again) retry?.()
    })
    return true
  }

  function settle(supplied: boolean): void {
    const current = pending.value
    pending.value = null
    current?.settle(supplied)
  }

  return { pending, supply, takeOver, settle }
}
