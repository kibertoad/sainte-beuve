import type { IntegrationId, IntegrationTokenStatus } from '@sainte-beuve/contracts'
import { integrationCapabilities, integrationLabel } from '@sainte-beuve/contracts'

/** What a screen needs of a credential input: a way to clear the draft in it. */
export interface DraftHolder {
  clearDraft: () => void
}

/**
 * Whether the caller may read the settings routes, which are admin-only.
 *
 * The shell starts the auth read on first paint; this only reads it again when
 * nobody has yet, because the answer decides whether the admin calls are made
 * at all. A member asking them would get 403s where the honest answer is "this
 * part is not yours".
 */
export async function callerIsAdmin(auth: ReturnType<typeof useAuthState>): Promise<boolean> {
  if (auth.state.value === null) await auth.refresh()
  return auth.isAdmin.value
}

/** What `useApiAction` hands back to run a call with. */
type RunAction = ReturnType<typeof useApiAction>['run']

/**
 * Start a sign-in or connect round trip. The URL is fetched and then navigated
 * to, rather than being a link: each call mints a signed state with a few
 * minutes of life, so the URL has to be the one this click produced.
 */
export async function startRoundTrip(
  run: RunAction,
  flow: { start: () => Promise<{ url: string }>; failure: string; key: string },
): Promise<void> {
  let url: string | null = null
  const started = await run(
    async () => {
      url = (await flow.start()).url
    },
    flow.failure,
    flow.key,
  )
  if (started && url !== null) window.location.assign(url)
}

/**
 * One integration's credential row, by id. A state this build has never heard of
 * reads as absent: the API is versioned separately from this bundle.
 */
function statusIn(
  integrations: readonly IntegrationTokenStatus[] | undefined,
  integrationId: IntegrationId,
): IntegrationTokenStatus {
  return (
    integrations?.find((row) => row.integrationId === integrationId) ?? {
      integrationId,
      state: 'absent',
      unreadableReason: null,
      inUse: false,
      hint: null,
      subject: null,
      updatedAt: null,
    }
  )
}

/**
 * The connections and the credential states every integration screen reads, and
 * the actions they share.
 *
 * One read for both, because they are entangled: storing one credential for a
 * host can change which other one is in force, and a screen that refreshed only
 * its own half would report a state that never existed. Lazy, so a click on a
 * screen renders it at once with a skeleton instead of holding the previous one.
 */
export function useIntegrationSettings() {
  const api = useSainteBeuveApi()
  const auth = useAuthState()
  const { confirm } = useConfirm()
  const capabilities = useCapabilities()

  const { data, pending, error, refresh } = useAsyncData(
    'integration-settings',
    async () => {
      if (!(await callerIsAdmin(auth))) return null
      const [connections, settings] = await Promise.all([
        api.getConnections(),
        api.getIntegrationSettings(),
      ])
      return { connections, integrations: settings.integrations }
    },
    { lazy: true },
  )

  const { busy, run } = useApiAction({ refresh })

  function statusOf(integrationId: IntegrationId): IntegrationTokenStatus {
    return statusIn(data.value?.integrations, integrationId)
  }

  /** Re-read what this org can do when a credential that gates something changed. */
  async function refreshCapabilitiesFor(integrationId: IntegrationId): Promise<void> {
    if (integrationCapabilities(integrationId).length > 0) await capabilities.refresh()
  }

  async function save(integrationId: IntegrationId, token: string, field: DraftHolder | null) {
    const stored = await run(
      () => api.setIntegrationToken(integrationId, token),
      'Could not store the credential',
      integrationId,
    )
    // Only on success: clearing after a refusal throws away what was pasted.
    if (stored) field?.clearDraft()
    await refreshCapabilitiesFor(integrationId)
  }

  /** Forget a stored credential, once somebody has said so twice: it cannot be shown again. */
  async function clear(integrationId: IntegrationId) {
    const confirmed = await confirm({
      title: `Forget the ${integrationLabel(integrationId)} credential?`,
      description:
        'This deployment loses what the credential reached until another one is stored, and it ' +
        'cannot be shown again: you will need the token itself to put it back.',
      confirmLabel: 'Clear the credential',
    })
    if (!confirmed) return
    await run(
      () => api.clearIntegrationToken(integrationId),
      'Could not clear the credential',
      integrationId,
    )
    await refreshCapabilitiesFor(integrationId)
  }

  function connect(start: () => Promise<{ url: string }>, failure: string, key: string) {
    return startRoundTrip(run, { start, failure, key })
  }

  return { api, auth, data, pending, error, refresh, busy, run, statusOf, save, clear, connect }
}
