import type { AuthState } from '@sainte-beuve/contracts'

/**
 * Who this browser is, shared by every screen that asks.
 *
 * `useState` rather than a fetch per component: the shell renders a name, the
 * Configuration screen renders the mode and the sign-in buttons, and two
 * independent reads would show two different answers for a second after a
 * sign-out. It is also the read that has to survive a 401 gracefully, because
 * `required` deployments answer one to everything else.
 *
 * A failed read is NOT an error state here. A backend that is down, or a
 * deployment this build is newer than, leaves the shell unable to say who is
 * looking, and the right thing to render then is the anonymous shell rather
 * than a page of apology: every screen below it reports its own failure with
 * the message the API gave.
 */
export function useAuthState() {
  const api = useSainteBeuveApi()
  const state = useState<AuthState | null>('auth-state', () => null)
  const pending = useState<boolean>('auth-state-pending', () => false)

  async function refresh(): Promise<void> {
    pending.value = true
    try {
      state.value = await api.getAuthState()
    } catch {
      state.value = null
    } finally {
      pending.value = false
    }
  }

  /** The person, when a person is signed in. Null for anonymous and for a key. */
  const viewer = computed(() =>
    state.value?.principal.kind === 'session' ? state.value.principal.viewer : null,
  )

  /** Whether a sign-in could be started at all, which decides whether to offer one. */
  const canSignIn = computed(() => (state.value?.signInProviders ?? []).length > 0)

  return { state, pending, viewer, canSignIn, refresh }
}
