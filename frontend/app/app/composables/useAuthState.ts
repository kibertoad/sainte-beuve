import type { AuthState } from '@sainte-beuve/contracts'

/**
 * The read that is already on its way, so two callers make one request.
 *
 * The shell starts this on first paint and a screen that needs the answer
 * before it decides what else to ask for (Configuration) may want it a moment
 * later, from a component that cannot see the shell's promise. Holding the
 * PROMISE rather than a boolean is what lets the second caller await the first
 * one's answer instead of issuing a second `GET /auth` beside it.
 *
 * Module-scoped because this layer is a client-only SPA (`ssr: false`): there is
 * one browser and one instance of this module per page load, so there is no
 * request whose state could leak into another's.
 */
let inFlight: Promise<void> | null = null

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

  async function read(): Promise<void> {
    pending.value = true
    try {
      state.value = await api.getAuthState()
    } catch {
      state.value = null
    } finally {
      pending.value = false
    }
  }

  function refresh(): Promise<void> {
    // Cleared on settle rather than kept: this is a de-duplication window, not a
    // cache. A later `refresh()` — after a sign-out, say — has to ask again.
    inFlight ??= read().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  /** The person, when a person is signed in. Null for anonymous and for a key. */
  const viewer = computed(() =>
    state.value?.principal.kind === 'session' ? state.value.principal.viewer : null,
  )

  /** Whether a sign-in could be started at all, which decides whether to offer one. */
  const canSignIn = computed(() => (state.value?.signInProviders ?? []).length > 0)

  /**
   * The org this browser is looking at. Null only while the read has not landed
   * or could not be made, which is the same state `viewer` is null in.
   */
  const org = computed(() => state.value?.org ?? null)

  /**
   * Whether the caller may administer this org: credentials, keys, the registry,
   * the directory.
   *
   * It defaults to FALSE while the state is unknown, which is the safe direction
   * for a screen: an admin sees the Configuration link a moment late, where a
   * member would otherwise see it and be refused by the API a click later. The
   * API is the guard either way — this only decides what is worth offering.
   */
  const isAdmin = computed(() => state.value?.role === 'admin')

  return { state, pending, viewer, org, isAdmin, canSignIn, refresh }
}
