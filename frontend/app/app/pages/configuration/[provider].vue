<script setup lang="ts">
import type { VcsProvider } from '@sainte-beuve/contracts'
import { isVcsProvider, vcsDisplayName, vcsPatCredentialKey } from '@sainte-beuve/contracts'
import type { DraftHolder } from '../../composables/useIntegrationSettings'

// One source-control host. Static siblings (`slack`, `cat-factory`) win over
// this route, so only a host slug reaches it, and anything else is a 404.
definePageMeta({
  validate: (route) =>
    typeof route.params.provider === 'string' && isVcsProvider(route.params.provider),
})

const route = useRoute()
const toast = useToast()
const { api, data, pending, error, refresh, busy, run, statusOf, save, clear, connect } =
  useIntegrationSettings()

const provider = computed(() => route.params.provider as VcsProvider)
const hostName = computed(() => vcsDisplayName(provider.value))
const connection = computed(
  () => data.value?.connections.vcs.find((row) => row.provider === provider.value) ?? null,
)
const patKey = computed(() => vcsPatCredentialKey(provider.value))

const card = ref<DraftHolder | null>(null)

async function signOut() {
  await run(
    () => api.disconnectSignIn(provider.value),
    `Could not disconnect ${hostName.value}`,
    `${provider.value}-sign-out`,
  )
}

// A connect round trip lands back here with `?connected=<host>`, on a fresh
// load that already shows the new state. Without a word, a redirect to an
// unchanged-looking screen reads as a flow that silently did nothing.
onMounted(() => {
  const connected = route.query.connected
  if (typeof connected === 'string' && isVcsProvider(connected)) {
    toast.add({ color: 'success', title: `${vcsDisplayName(connected)} connection updated` })
  }
})
</script>

<template>
  <IntegrationScreen
    :title="hostName"
    :description="`How this deployment reads ${hostName} and posts its verdicts there.`"
    :pending="pending"
    :error="error"
    :loaded="connection !== null"
    @refresh="refresh()"
  >
    <VcsConnectionCard
      v-if="connection"
      ref="card"
      :connection="connection"
      :pat-status="statusOf(patKey)"
      :api-base="api.apiBase"
      :busy="busy !== null"
      @install-app="
        connect(api.startGitHubAppInstall, 'Could not start the App install', 'github-app')
      "
      @sign-in="
        connect(
          () => api.startSignIn(provider),
          'Could not start the sign-in',
          `${provider}-sign-in`,
        )
      "
      @sign-out="signOut()"
      @save-pat="save(patKey, $event, card)"
      @clear-pat="clear(patKey)"
    />
  </IntegrationScreen>
</template>
