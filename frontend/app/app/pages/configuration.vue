<script setup lang="ts">
import type {
  IntegrationId,
  IntegrationTokenState,
  IntegrationTokenStatus,
  IntegrationTokenUnreadableReason,
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
const { busy, run } = useApiAction({ refresh })

const integrations = computed<IntegrationTokenStatus[]>(() => data.value?.integrations ?? [])

/** The copy explaining what each credential is for. The API carries ids and state, not prose. */
const CATALOG = {
  'cat-factory': {
    label: 'cat-factory',
    description:
      'The instance AI reviews are delegated to. The API token is sealed before it is stored ' +
      'and is never shown again.',
  },
} satisfies Record<IntegrationId, { label: string; description: string }>

const STATE_LABEL = {
  absent: 'Not configured',
  stored: 'Configured',
  unreadable: 'Unreadable',
} satisfies Record<IntegrationTokenState, string>

const STATE_COLOR = {
  absent: 'neutral',
  stored: 'success',
  unreadable: 'error',
} satisfies Record<IntegrationTokenState, 'neutral' | 'success' | 'error'>

/** Each fault gets the instruction that fixes it, because they do not share one. */
const UNREADABLE_COPY = {
  no_key: {
    title: 'This deployment has no usable encryption key',
    description:
      'The stored token cannot be opened, and a replacement cannot be stored either, until ' +
      'SETTINGS_ENCRYPTION_KEY holds a usable key.',
  },
  key_mismatch: {
    title: 'This token was sealed under a different encryption key',
    description:
      'Restore the key it was sealed under, or enter the token again to seal it under the ' +
      'current one.',
  },
  corrupt: {
    title: 'This token is not a readable envelope',
    description:
      'The stored value is truncated, altered, or was written by another encryption scheme. ' +
      'No key opens it: enter the token again.',
  },
} satisfies Record<IntegrationTokenUnreadableReason, { title: string; description: string }>

// The API is versioned separately from this SPA, so a deployment can serve a
// newer backend than the bundle it built: an id or a state this build has never
// heard of has to render as itself rather than throw and blank the whole page.
function lookup<T>(table: Record<string, T | undefined>, key: string): T | undefined {
  return table[key]
}

function catalogFor(integrationId: string): { label: string; description: string } {
  return (
    lookup(CATALOG, integrationId) ?? {
      label: integrationId,
      description: 'An integration this deployment knows and this screen does not.',
    }
  )
}

/**
 * Stored and in use are two different facts, so the badge says which one it
 * means: a green "Configured" on a token nothing reads yet claims a capability
 * the deployment does not have.
 */
function badgeFor(integration: IntegrationTokenStatus): {
  color: 'neutral' | 'success' | 'error' | 'warning'
  label: string
} {
  if (integration.state === 'stored' && !integration.inUse) {
    return { color: 'warning', label: 'Stored, not in use' }
  }
  return {
    color: lookup(STATE_COLOR, integration.state) ?? 'neutral',
    label: lookup(STATE_LABEL, integration.state) ?? integration.state,
  }
}

function unreadableCopy(integration: IntegrationTokenStatus): {
  title: string
  description: string
} {
  return (
    lookup(UNREADABLE_COPY, integration.unreadableReason ?? '') ?? {
      title: 'This token cannot be decrypted',
      description:
        'This deployment cannot open the stored token. Enter it again, or check the API log ' +
        'for the reason.',
    }
  )
}

/** What has been typed and not yet sent, per integration. Cleared once it is stored. */
const drafts = reactive<Record<string, string | undefined>>({})

/** Trimmed, and the same test the Save button is disabled by: whitespace is not a token. */
function draftToken(integrationId: string): string {
  return (drafts[integrationId] ?? '').trim()
}

async function save(integrationId: IntegrationId) {
  const token = draftToken(integrationId)
  if (token.length === 0) return
  const stored = await run(
    () => api.setIntegrationToken(integrationId, token),
    'Could not store the token',
    integrationId,
  )
  // Only on success. Clearing it after a refusal (503 with no encryption key, or
  // a token the contract rejected) would throw away what the operator pasted and
  // make them fetch the credential again.
  if (stored) drafts[integrationId] = ''
}

async function clear(integrationId: IntegrationId) {
  await run(
    () => api.clearIntegrationToken(integrationId),
    'Could not clear the token',
    integrationId,
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
              <p class="font-medium">{{ catalogFor(integration.integrationId).label }}</p>
              <p class="text-sm text-muted">
                {{ catalogFor(integration.integrationId).description }}
              </p>
            </div>
            <div class="text-right shrink-0">
              <UBadge :color="badgeFor(integration).color" variant="subtle">
                {{ badgeFor(integration).label }}
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
            :title="unreadableCopy(integration).title"
            :description="unreadableCopy(integration).description"
          />

          <UAlert
            v-else-if="integration.state === 'stored' && !integration.inUse"
            class="mb-4"
            color="info"
            variant="subtle"
            title="This token is stored and nothing reads it yet"
            :description="`This deployment still reaches ${catalogFor(integration.integrationId).label} with the credential in its own environment, so the stored one takes effect only once that is wired to it.`"
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
              :disabled="draftToken(integration.integrationId).length === 0"
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
