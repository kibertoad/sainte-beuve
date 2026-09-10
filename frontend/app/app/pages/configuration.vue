<script setup lang="ts">
import type { IntegrationId, IntegrationTokenStatus } from '@sainte-beuve/contracts'

// Configuration: how this deployment reaches the systems it depends on.
//
// The page owns every API call and both reads, because the two are ENTANGLED:
// storing one GitHub credential can change which other one is in force, and
// disconnecting a sign-in can hand GitHub back to a pasted token. A card that
// refreshed only its own half would report a state that never existed.
//
// Credentials are write-only here, because they are write-only in the API: the
// screen shows which integration has one, its last four characters, and whether
// the deployment can still open it. Nothing on this page can read one back out.
const api = useSainteBeuveApi()
const route = useRoute()
const toast = useToast()

const { data, pending, error, refresh } = await useAsyncData('configuration', async () => {
  const [connections, settings] = await Promise.all([
    api.getConnections(),
    api.getIntegrationSettings(),
  ])
  return { connections, integrations: settings.integrations }
})

const { busy, run } = useApiAction({ refresh })

/**
 * The three credential inputs, so a successful save can clear the one it landed
 * on. Held here rather than inside each field because only the page knows the
 * call succeeded, and clearing on a refusal throws away what was pasted.
 */
const github = ref<{ clearDraft: () => void } | null>(null)
const slack = ref<{ clearDraft: () => void } | null>(null)
const catFactory = ref<{ clearDraft: () => void } | null>(null)

/**
 * One integration's row, by id. A state this build has never heard of is absent
 * rather than a crash: the API is versioned separately from this bundle, so a
 * deployment can serve a newer backend than the SPA it built.
 */
function statusOf(integrationId: IntegrationId): IntegrationTokenStatus {
  return (
    data.value?.integrations.find((row) => row.integrationId === integrationId) ?? {
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

async function save(
  integrationId: IntegrationId,
  token: string,
  field: { clearDraft: () => void } | null,
) {
  const stored = await run(
    () => api.setIntegrationToken(integrationId, token),
    'Could not store the credential',
    integrationId,
  )
  // Only on success. Clearing the input after a refusal (503 with no encryption
  // key, or a token GitHub rejected) throws away what the operator pasted.
  if (stored) field?.clearDraft()
}

function clear(integrationId: IntegrationId) {
  return run(
    () => api.clearIntegrationToken(integrationId),
    'Could not clear the credential',
    integrationId,
  )
}

/**
 * Start a connect round trip. The URL is fetched and then navigated to, rather
 * than being a link: each call mints a signed state with a few minutes of life,
 * so the URL has to be the one this click produced.
 */
async function connect(start: () => Promise<{ url: string }>, failure: string, key: string) {
  let url: string | null = null
  const started = await run(
    async () => {
      url = (await start()).url
    },
    failure,
    key,
  )
  if (started && url !== null) window.location.assign(url)
}

async function signOut() {
  await run(() => api.disconnectGitHubSignIn(), 'Could not disconnect GitHub', 'github-sign-out')
}

// The connect callbacks send the browser back here with `?connected=github`, and
// the page has just loaded fresh, so the state is already the new one: this only
// has to say that the round trip finished. Without it a redirect back to an
// unchanged-looking screen reads as a flow that silently did nothing.
onMounted(() => {
  if (route.query.connected === 'github') {
    toast.add({ color: 'success', title: 'GitHub connection updated' })
  }
})
</script>

<template>
  <UContainer class="py-8">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold">Configuration</h1>
      <p class="text-sm text-muted">How this deployment reaches the systems it depends on.</p>
    </div>

    <div class="flex items-center justify-between mb-4">
      <p class="text-sm text-muted">
        Credentials are encrypted before they are stored, and never shown again. Enter one again to
        replace it.
      </p>
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

    <div v-else-if="data" class="flex flex-col gap-4">
      <GitHubConnectionCard
        ref="github"
        :connection="data.connections.github"
        :pat-status="statusOf('github-pat')"
        :api-base="api.apiBase"
        :busy="busy !== null"
        @install-app="
          connect(api.startGitHubAppInstall, 'Could not start the App install', 'github-app')
        "
        @sign-in="connect(api.startGitHubSignIn, 'Could not start the sign-in', 'github-sign-in')"
        @sign-out="signOut()"
        @save-pat="save('github-pat', $event, github)"
        @clear-pat="clear('github-pat')"
      />

      <SlackConnectionCard
        ref="slack"
        :connection="data.connections.slack"
        :token-status="statusOf('slack-bot-token')"
        :api-base="api.apiBase"
        :busy="busy !== null"
        @save="save('slack-bot-token', $event, slack)"
        @clear="clear('slack-bot-token')"
      />

      <UCard>
        <div class="mb-4">
          <p class="font-medium">cat-factory</p>
        </div>
        <CredentialField
          ref="catFactory"
          :status="statusOf('cat-factory')"
          :busy="busy === 'cat-factory'"
          placeholder="cf_live_…"
          description="The instance AI reviews are delegated to. The key alone is not enough: the deployment also needs a base URL and a service id, and until it has both this credential is stored and unused."
          @save="save('cat-factory', $event, catFactory)"
          @clear="clear('cat-factory')"
        />
      </UCard>
    </div>
  </UContainer>
</template>
