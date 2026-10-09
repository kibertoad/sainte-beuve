<script setup lang="ts">
import type { Role } from '@sainte-beuve/contracts'
import { isVcsProvider } from '@sainte-beuve/contracts'
import { callerIsAdmin, startRoundTrip } from '../../composables/useIntegrationSettings'
import { integrationEntries } from '../../utils/integrations'

// Configuration: who is calling, the keys machines call with, and the list of
// integrations, each of which is configured on its own screen.
const api = useSainteBeuveApi()
const route = useRoute()
const auth = useAuthState()

// A backend older than this bundle still sends a connect round trip back here
// rather than to the host's own screen. Forwarded, so its toast is not lost.
const connected = route.query.connected
if (typeof connected === 'string' && isVcsProvider(connected)) {
  await navigateTo({ path: `/configuration/${connected}`, query: { connected } }, { replace: true })
}

// Lazy, so a click on this destination renders at once. The Access card is
// outside the admin read: it holds the only sign-in button, and a `required`
// deployment refuses the settings routes to anybody who has not used it yet.
const { data, pending, error, refresh } = useAsyncData(
  'configuration',
  async () => {
    if (!(await callerIsAdmin(auth))) return null
    const [connections, keys] = await Promise.all([api.getConnections(), api.listApiKeys()])
    return { integrations: integrationEntries(connections), apiKeys: keys.apiKeys }
  },
  { lazy: true },
)

const { busy, run } = useApiAction({ refresh })
const { confirm } = useConfirm()

/** The one time a minted key is readable. See AccessCard. */
const issuedKey = ref<string | null>(null)

async function mintKey(key: { label: string; role: Role }) {
  let token: string | null = null
  const minted = await run(
    async () => {
      token = (await api.createApiKey(key.label, key.role)).token
    },
    'Could not mint an API key',
    'create-key',
  )
  if (minted) issuedKey.value = token
}

/**
 * Revoke a key, once somebody has said so twice. The store holds only a digest,
 * so a revoked key cannot be reinstated, and the button is one slip from the row
 * above.
 */
async function revokeKey(keyId: string) {
  const key = data.value?.apiKeys.find((row) => row.id === keyId)
  const confirmed = await confirm({
    title: `Revoke ${key?.label ?? 'this API key'}?`,
    description:
      'Anything calling with it stops working at its next request. The key cannot be restored ' +
      '(this deployment holds only a digest of it), so whatever uses it needs a new one.',
    confirmLabel: 'Revoke the key',
  })
  if (!confirmed) return
  // Cleared first, so a secret that stopped working is not left on screen.
  issuedKey.value = null
  await run(() => api.revokeApiKey(keyId), 'Could not revoke the API key', keyId)
}

async function endSession() {
  await run(
    async () => {
      await api.signOut()
      // Before the refresh `run` makes next: the read keeps whoever it already
      // has, so without this it would still send the admin-only calls.
      auth.invalidate()
    },
    'Could not sign out',
    'sign-out',
  )
}

/**
 * Start a sign-in that establishes a SESSION, as opposed to the button on a host
 * screen, which connects the deployment's own credential.
 */
function signIn(provider: string) {
  if (!isVcsProvider(provider)) return
  return startRoundTrip(run, {
    start: () => api.startSessionSignIn(provider),
    failure: 'Could not start the sign-in',
    key: `sign-in-${provider}`,
  })
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold">Configuration</h1>
      <p class="text-sm text-muted">How this deployment reaches the systems it depends on.</p>
    </div>

    <AccessCard
      v-if="auth.state.value"
      v-model:issued="issuedKey"
      class="mb-8"
      :state="auth.state.value"
      :api-keys="data?.apiKeys ?? null"
      :busy="busy"
      @sign-in="signIn($event)"
      @sign-out="endSession()"
      @create-key="mintKey($event)"
      @revoke-key="revokeKey($event)"
    />

    <NuxtLink to="/configuration/organization" class="group block mb-8">
      <UCard class="transition-colors group-hover:bg-elevated/50">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-building-2" class="size-6 shrink-0 text-muted" />
          <div class="min-w-0 flex-1">
            <p class="font-medium">Organization</p>
            <p class="text-sm text-muted">
              {{ auth.org.value?.name ?? 'This org' }}: its settings, its teams, and the other
              organizations here.
            </p>
          </div>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-muted" />
        </div>
      </UCard>
    </NuxtLink>

    <div class="flex items-center justify-between gap-3 mb-4">
      <h2 class="text-lg font-semibold">Integrations</h2>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="ghost"
        class="shrink-0"
        :loading="pending"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </div>

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the configuration" />

    <LoadingCard v-else-if="data === undefined" :rows="4" />

    <UAlert
      v-else-if="!auth.isAdmin.value"
      color="neutral"
      variant="subtle"
      title="Integrations belong to an admin"
      description="How this org reaches GitHub, GitLab, Slack and cat-factory, and the keys machines call it with, are an admin's to change. Ask one of them, or sign in to an org you administer."
    />

    <nav v-else-if="data" aria-label="Integrations" class="flex flex-col gap-3">
      <NuxtLink v-for="entry in data.integrations" :key="entry.to" :to="entry.to" class="group">
        <UCard class="transition-colors group-hover:bg-elevated/50">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <UIcon :name="entry.icon" class="size-6 shrink-0 text-muted" />
              <div class="min-w-0">
                <p class="font-medium">{{ entry.name }}</p>
                <p class="text-sm text-muted">{{ entry.description }}</p>
              </div>
            </div>
            <div class="flex items-center justify-between gap-2 sm:justify-end">
              <UBadge :color="entry.badge.color" variant="subtle">{{ entry.badge.label }}</UBadge>
              <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-muted" />
            </div>
          </div>
        </UCard>
      </NuxtLink>
    </nav>
  </UContainer>
</template>
