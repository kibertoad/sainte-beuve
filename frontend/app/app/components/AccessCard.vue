<script setup lang="ts">
import type { ApiKey, AuthState } from '@sainte-beuve/contracts'
import { vcsDisplayName } from '@sainte-beuve/contracts'

// Who may call this deployment, and the keys the machines call with.
//
// Beside the credential cards rather than on a screen of its own, because it
// answers the same question they do: what does this deployment believe about
// the world outside it. The two halves here are a person (a session, from a
// sign-in) and a machine (a key), and they are deliberately not interchangeable
// — a key has no workspace, and the card says so rather than leaving somebody to
// discover it from a 403.
const props = defineProps<{
  state: AuthState
  apiKeys: ApiKey[]
  busy: string | null
}>()

const emit = defineEmits<{
  signIn: [provider: string]
  signOut: []
  createKey: [label: string]
  revokeKey: [keyId: string]
}>()

const label = ref('')

/**
 * The key a mint just answered with, held until the operator navigates away.
 *
 * The only place it ever exists: the store holds a digest, so a screen that
 * dropped it on the next refresh would leave somebody with a credential nobody
 * can recover. Cleared on a revoke as well, so a stale secret is not left on
 * screen beside the row it belonged to.
 */
const issued = defineModel<string | null>('issued', { default: null })

const mode = computed(() =>
  props.state.mode === 'required'
    ? { color: 'success' as const, label: 'Sign-in required' }
    : { color: 'warning' as const, label: 'Open' },
)

const principal = computed(() => props.state.principal)

function mint() {
  const typed = label.value.trim()
  if (typed.length === 0) return
  emit('createKey', typed)
  label.value = ''
}
</script>

<template>
  <UCard>
    <div class="flex items-start justify-between gap-4 mb-4">
      <div class="min-w-0">
        <p class="font-medium">Access</p>
        <p class="text-sm text-muted">Who may call this deployment, and as whom.</p>
      </div>
      <UBadge :color="mode.color" variant="subtle" class="shrink-0">{{ mode.label }}</UBadge>
    </div>

    <UAlert
      v-if="state.mode === 'open'"
      class="mb-4"
      color="warning"
      variant="subtle"
      title="Anyone who can reach this deployment can use it"
      description="Nothing is refused for being anonymous, and the workspace renders for whoever this deployment's source-control credential acts as, so everybody sees the same person's lists. That is right for a laptop and wrong for anything shared: set AUTH_MODE=required, with an OAuth client so people can sign in."
    />
    <UAlert
      v-else-if="state.signInProviders.length === 0"
      class="mb-4"
      color="error"
      variant="subtle"
      title="Nobody can sign in here"
      description="This deployment requires a caller to identify itself and has no OAuth client to identify anybody with. Only an API key gets in. Configure GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET (or the GitLab pair), plus SETTINGS_ENCRYPTION_KEY, which signs the round trip."
    />

    <div class="flex items-center justify-between gap-4">
      <div class="text-sm min-w-0">
        <p v-if="principal.kind === 'session'">
          Signed in as <strong>{{ principal.viewer.reviewer.displayName }}</strong>
          <span class="text-muted"> on {{ vcsDisplayName(principal.session.provider) }}</span>
        </p>
        <p v-else-if="principal.kind === 'api_key'" class="text-muted">
          Calling with the API key <strong>{{ principal.label }}</strong
          >, which is not a person: the workspace has nothing to render for it.
        </p>
        <p v-else class="text-muted">Not signed in.</p>
      </div>
      <div class="flex gap-2 shrink-0">
        <UButton
          v-if="principal.kind === 'session'"
          variant="ghost"
          icon="i-lucide-log-out"
          :loading="busy === 'sign-out'"
          @click="emit('signOut')"
        >
          Sign out
        </UButton>
        <UButton
          v-for="provider in state.signInProviders"
          v-else
          :key="provider"
          variant="subtle"
          icon="i-lucide-log-in"
          :loading="busy === `sign-in-${provider}`"
          @click="emit('signIn', provider)"
        >
          Sign in with {{ vcsDisplayName(provider) }}
        </UButton>
      </div>
    </div>

    <USeparator class="my-4" />

    <div class="text-sm">
      <p class="font-medium mb-1">API keys</p>
      <p class="text-muted mb-3">
        For CI and scripts, presented as <code>Authorization: Bearer &lt;key&gt;</code>. A key is
        not a person, so it can read and write the board and has no workspace of its own. It is
        shown once and stored as a digest: lose it and mint another.
      </p>

      <UAlert
        v-if="issued"
        class="mb-3"
        color="success"
        variant="subtle"
        title="Copy this key now"
        :description="issued"
        :close="true"
        @update:open="issued = null"
      />

      <div class="flex gap-2 mb-3">
        <UInput
          v-model="label"
          class="flex-1"
          placeholder="What is it for? e.g. release pipeline"
          @keyup.enter="mint()"
        />
        <UButton
          icon="i-lucide-plus"
          :disabled="label.trim().length === 0"
          :loading="busy === 'create-key'"
          @click="mint()"
        >
          Mint
        </UButton>
      </div>

      <p v-if="apiKeys.length === 0" class="text-muted">No keys have been minted here.</p>
      <ul v-else class="flex flex-col divide-y divide-default">
        <li v-for="key in apiKeys" :key="key.id" class="flex items-center gap-3 py-2">
          <span class="font-medium truncate">{{ key.label }}</span>
          <code class="text-muted">…{{ key.hint }}</code>
          <span class="text-muted ml-auto">
            {{ key.lastUsedAt === null ? 'never used' : 'in use' }}
          </span>
          <UButton
            icon="i-lucide-trash-2"
            variant="ghost"
            color="error"
            :loading="busy === key.id"
            @click="emit('revokeKey', key.id)"
          >
            Revoke
          </UButton>
        </li>
      </ul>
    </div>
  </UCard>
</template>
