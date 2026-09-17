<script setup lang="ts">
import type { ApiKey, AuthState, Role } from '@sainte-beuve/contracts'
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
  /**
   * The keys this org has minted, or NULL for a caller who could not read them.
   * The list lives under `/api/v1/settings`, which a `required` deployment
   * refuses to anybody anonymous and which is admin-only besides — and this card
   * is where both of them sign in and out, so it has to render for exactly those
   * callers. Empty and unreadable are different answers, and saying "no keys have
   * been minted here" to somebody who was refused the question would be the wrong
   * one.
   */
  apiKeys: ApiKey[] | null
  busy: string | null
}>()

const emit = defineEmits<{
  signIn: [provider: string]
  signOut: []
  createKey: [key: { label: string; role: Role }]
  revokeKey: [keyId: string]
}>()

const label = ref('')

/**
 * What the key may do, chosen HERE because it is chosen at mint time and never
 * afterwards: a key outlives whoever made it, so inheriting the minter's role is
 * how a build script comes to be able to revoke the credentials it runs on.
 * `member` by default, which is the job most keys have.
 */
const role = ref<Role>('member')

const roles = [
  { value: 'member' as const, label: 'Member' },
  { value: 'admin' as const, label: 'Admin' },
]

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
  emit('createKey', { label: typed, role: role.value })
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
      <p v-if="apiKeys === null" class="text-muted">
        {{
          state.role === 'admin'
            ? 'Sign in to mint a key or see the ones this org already has. A key is for CI and scripts, and minting one needs a caller this deployment can name — including here, where it would otherwise refuse nobody.'
            : 'The keys machines call this org with are an admin\u2019s to see and to mint.'
        }}
      </p>
      <template v-else>
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

        <!--
          The form is hidden rather than shown and refused. Minting is the one
          route an `open` deployment still asks who is calling on, because a key
          outlives the mode it was minted in, so an anonymous operator here has a
          button that can only fail — and the reason is worth reading before the
          click rather than in a toast after it.
        -->
        <p v-if="principal.kind === 'anonymous'" class="text-muted mb-3">
          Sign in above to mint one, or call
          <code>POST /api/v1/settings/api-keys</code> with this deployment's own
          <code>AUTH_API_KEY</code>. A key keeps working after <code>AUTH_MODE=required</code>, so
          this deployment will not hand one to a caller it cannot name even while it refuses nobody
          else.
        </p>
        <div v-else class="flex gap-2 mb-3">
          <UInput
            v-model="label"
            class="flex-1"
            placeholder="What is it for? e.g. release pipeline"
            @keyup.enter="mint()"
          />
          <USelect v-model="role" :items="roles" value-key="value" class="w-32" />
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
            <UBadge v-if="key.role === 'admin'" color="warning" variant="subtle">admin</UBadge>
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
      </template>
    </div>
  </UCard>
</template>
