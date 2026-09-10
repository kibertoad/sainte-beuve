<script setup lang="ts">
import type {
  IntegrationId,
  IntegrationTokenState,
  IntegrationTokenStatus,
} from '@sainte-beuve/contracts'

// Configuration: how this deployment reaches the systems it depends on. One
// section for now, and the sections are the seam to split on when there is a
// second one.
//
// A token is write-only here, because it is write-only in the API: the screen
// shows which integration has one, the last four characters of it, and whether
// the deployment can still open it. Nothing on this page can read a credential
// back out.
const api = useSainteBeuveApi()
const { data, pending, error, refresh } = await useAsyncData('integration-settings', () =>
  api.getIntegrationSettings(),
)

const integrations = computed<IntegrationTokenStatus[]>(() => data.value?.integrations ?? [])

/** The copy explaining what each credential is for. The API carries ids and state, not prose. */
const CATALOG: Record<IntegrationId, { label: string; description: string }> = {
  'cat-factory': {
    label: 'cat-factory',
    description:
      'The instance AI reviews are delegated to. The API token is sealed before it is stored ' +
      'and is never shown again.',
  },
}

const STATE_LABEL: Record<IntegrationTokenState, string> = {
  absent: 'Not configured',
  stored: 'Configured',
  unreadable: 'Unreadable',
}

const STATE_COLOR: Record<IntegrationTokenState, 'neutral' | 'success' | 'error'> = {
  absent: 'neutral',
  stored: 'success',
  unreadable: 'error',
}

/** What has been typed and not yet sent, per integration. Cleared once it is stored. */
const drafts = reactive<Partial<Record<IntegrationId, string>>>({})
const busy = ref<IntegrationId | null>(null)
const toast = useToast()

/**
 * Run one configuration change and say what happened. Storing refuses for
 * reasons an operator can act on (503 while no encryption key is configured),
 * and an unhandled rejection would leave the button looking merely dead.
 */
async function act(integrationId: IntegrationId, action: () => Promise<unknown>, failure: string) {
  busy.value = integrationId
  try {
    await action()
    await refresh()
  } catch (err) {
    toast.add({ color: 'error', title: failure, description: apiErrorMessage(err) })
  } finally {
    busy.value = null
  }
}

async function save(integrationId: IntegrationId) {
  const token = (drafts[integrationId] ?? '').trim()
  if (token.length === 0) return
  await act(
    integrationId,
    () => api.setIntegrationToken(integrationId, token),
    'Could not store the token',
  )
  drafts[integrationId] = ''
}

async function clear(integrationId: IntegrationId) {
  await act(
    integrationId,
    () => api.clearIntegrationToken(integrationId),
    'Could not clear the token',
  )
}
</script>

<template>
  <UContainer class="py-8">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold">Configuration</h1>
      <p class="text-sm text-muted">How this deployment reaches the systems it depends on.</p>
    </div>

    <section>
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-medium">Integrations</h2>
          <p class="text-sm text-muted">
            Credentials are encrypted before they are stored. Enter one again to replace it.
          </p>
        </div>
        <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="pending" @click="refresh()">
          Refresh
        </UButton>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        title="Could not reach the sainte-beuve API"
        :description="`Tried ${api.apiBase}. Is the backend running?`"
      />

      <div v-else class="flex flex-col gap-3">
        <UCard v-for="integration in integrations" :key="integration.integrationId">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div class="min-w-0">
              <p class="font-medium">{{ CATALOG[integration.integrationId].label }}</p>
              <p class="text-sm text-muted">{{ CATALOG[integration.integrationId].description }}</p>
            </div>
            <div class="text-right shrink-0">
              <UBadge :color="STATE_COLOR[integration.state]" variant="subtle">
                {{ STATE_LABEL[integration.state] }}
              </UBadge>
              <p v-if="integration.hint" class="text-xs text-muted mt-1">
                ends in {{ integration.hint }}
              </p>
            </div>
          </div>

          <UAlert
            v-if="integration.state === 'unreadable'"
            class="mb-4"
            color="warning"
            variant="subtle"
            title="This token cannot be decrypted"
            description="It was sealed under a different encryption key. Restore that key, or enter the token again."
          />

          <div class="flex items-center gap-2">
            <UInput
              v-model="drafts[integration.integrationId]"
              class="flex-1"
              type="password"
              autocomplete="off"
              placeholder="Paste an API token"
              @keyup.enter="save(integration.integrationId)"
            />
            <UButton
              :loading="busy === integration.integrationId"
              :disabled="!drafts[integration.integrationId]"
              @click="save(integration.integrationId)"
            >
              Save
            </UButton>
            <UButton
              v-if="integration.state !== 'absent'"
              variant="ghost"
              color="neutral"
              :loading="busy === integration.integrationId"
              @click="clear(integration.integrationId)"
            >
              Clear
            </UButton>
          </div>
        </UCard>
      </div>
    </section>
  </UContainer>
</template>
