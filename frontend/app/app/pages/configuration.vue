<script setup lang="ts">
import type {
  IntegrationId,
  IntegrationTokenStatus,
  Role,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { isVcsProvider, vcsDisplayName, vcsPatCredentialKey } from '@sainte-beuve/contracts'

// Configuration: how this deployment reaches the systems it depends on.
//
// The page owns every API call and both reads, because the two are ENTANGLED:
// storing one credential for a host can change which other one is in force, and
// disconnecting a sign-in can hand the host back to a pasted token. A card that
// refreshed only its own half would report a state that never existed.
//
// Credentials are write-only here, because they are write-only in the API: the
// screen shows which integration has one, its last four characters, and whether
// the deployment can still open it. Nothing on this page can read one back out.
const api = useSainteBeuveApi()
const route = useRoute()
const toast = useToast()

const auth = useAuthState()

// LAZY, and not awaited: a page that awaits its read at setup holds the previous
// screen on screen until the whole list is down, validated and mounted, so a
// click on this destination looks like nothing happened. Rendered immediately
// instead, the skeleton below says what is coming. `AiReviewPanel` has done this
// since it was written, for the same reason.
const { data, pending, error, refresh } = useAsyncData(
  'configuration',
  async () => {
    // Who is calling is read FIRST and ON ITS OWN, which is the whole shape of
    // this. Everything below it is under `/api/v1/settings` and is refused
    // outright on a `required` deployment nobody has signed in to yet, while the
    // Access card this feeds holds the only sign-in button there is: a page that
    // let that refusal take the card down with it would make the documented way
    // in unreachable in the one mode it exists for. `auth.refresh()` never
    // rejects, so this settles either way.
    //
    // Only when nobody has read it yet, though. The state is shared (`useState`),
    // the shell starts the same read on first paint, and a second one here put a
    // third sequential round trip in front of this screen for an answer already on
    // its way. A visit that arrives before the shell's read lands still makes it,
    // which is the case this has to cover: the admin check below is what decides
    // whether the settings calls are made at all.
    //
    // What makes holding the answer safe is that the one thing on this page which
    // changes it says so: `endSession` calls `auth.invalidate()` before the
    // refresh it triggers reaches here, so a sign-out reads again and this screen
    // flips to anonymous. Anything else added here that changes who is calling
    // owes the same call.
    if (auth.state.value === null) await auth.refresh()
    // NOT ASKED FOR AT ALL unless the caller may have them. Everything below is
    // admin-only since the org boundary landed, and a member reaching this page —
    // which they do, because it holds the only sign-out button — would otherwise
    // get three 403s and an error alert where the honest answer is "this part is
    // not yours". The API is still the guard; this only decides what to ask.
    if (!auth.isAdmin.value) return null
    // The rest is one call for the reason the two credential reads are one call:
    // minting a key and connecting a host both change what this page says about
    // who may call, and a card that refreshed only its own half would report a
    // state that never existed.
    const [connections, settings, keys] = await Promise.all([
      api.getConnections(),
      api.getIntegrationSettings(),
      api.listApiKeys(),
    ])
    return { connections, integrations: settings.integrations, apiKeys: keys.apiKeys }
  },
  { lazy: true },
)

const { busy, run } = useApiAction({ refresh })

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

function revokeKey(keyId: string) {
  // Cleared first: leaving a secret on screen beside a list it is no longer in
  // invites somebody to store a key that stopped working a moment ago.
  issuedKey.value = null
  return run(() => api.revokeApiKey(keyId), 'Could not revoke the API key', keyId)
}

async function endSession() {
  await run(
    async () => {
      await api.signOut()
      // BEFORE the refresh below, which is what `run` does next: the handler
      // keeps whoever it already read (see the guard in it), so a sign-out that
      // did not say the held answer is stale would re-run the handler against
      // the signed-in one — leaving the Access card showing the person as
      // signed in, and `isAdmin` still true, which sends three admin-only
      // settings calls the API has just started refusing.
      auth.invalidate()
    },
    'Could not sign out',
    'sign-out',
  )
}

// The credential inputs, so a successful save can clear the one it landed on.
// Held on the page rather than inside each field because only the page knows
// the call succeeded, and clearing on a refusal throws away what was pasted.

/** What the page needs of a credential input: a way to clear the draft in it. */
interface DraftHolder {
  clearDraft: () => void
}

const slack = ref<DraftHolder | null>(null)
const catFactory = ref<DraftHolder | null>(null)

/**
 * The host cards, keyed by HOST rather than by position in the loop.
 *
 * Vue does not promise that a `ref` array inside a `v-for` is in the source
 * order, so an index would let the GitLab save clear the GitHub card, wiping a
 * token somebody had just typed into the other one while leaving the saved one
 * on screen. Not reactive: nothing renders from it, a save reads it.
 */
const hostCards: Partial<Record<VcsProvider, DraftHolder | null>> = {}
const hostCardBinders = new Map<VcsProvider, (el: unknown) => void>()

/** One stable binder per host, so a re-render does not re-bind every card. */
function bindHostCard(provider: VcsProvider): (el: unknown) => void {
  const held = hostCardBinders.get(provider)
  if (held !== undefined) return held
  const bind = (el: unknown): void => {
    hostCards[provider] = el as DraftHolder | null
  }
  hostCardBinders.set(provider, bind)
  return bind
}

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

async function save(integrationId: IntegrationId, token: string, field: DraftHolder | null) {
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

/**
 * Start a sign-in that establishes a SESSION, as opposed to the button on a host
 * card, which connects the deployment's own credential. Two flows over one OAuth
 * client, because one of them is an operator acting on shared state.
 */
function signIn(provider: string) {
  if (!isVcsProvider(provider)) return
  return connect(
    () => api.startSessionSignIn(provider),
    'Could not start the sign-in',
    `sign-in-${provider}`,
  )
}

async function signOut(provider: VcsProvider) {
  await run(
    () => api.disconnectSignIn(provider),
    `Could not disconnect ${vcsDisplayName(provider)}`,
    `${provider}-sign-out`,
  )
}

// The connect callbacks send the browser back here with `?connected=<host>`,
// and the page has just loaded fresh, so the state is already the new one: this
// only has to say that the round trip finished. Without it a redirect back to
// an unchanged-looking screen reads as a flow that silently did nothing.
onMounted(() => {
  const connected = route.query.connected
  // Named, and CHECKED: the value is whatever the URL carries, so a slug this
  // build does not know is not worth echoing into a toast, and `github` in a
  // sentence reads like a bug report where GitHub reads like a product.
  if (typeof connected === 'string' && isVcsProvider(connected)) {
    toast.add({ color: 'success', title: `${vcsDisplayName(connected)} connection updated` })
  }
})
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold">Configuration</h1>
      <p class="text-sm text-muted">How this deployment reaches the systems it depends on.</p>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <p class="text-sm text-muted">
        Credentials are encrypted before they are stored, and never shown again. Enter one again to
        replace it.
      </p>
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

    <!--
      Outside the block below, and above the failure it reports. The rest of this
      screen reads the credential routes, which a `required` deployment refuses
      to anybody who has not signed in — and signing in is what this card is for.
      Its key half takes `null` for "this caller could not read them", which is
      the same refusal seen from the other side.
    -->
    <AccessCard
      v-if="auth.state.value"
      v-model:issued="issuedKey"
      class="mb-4"
      :state="auth.state.value"
      :api-keys="data?.apiKeys ?? null"
      :busy="busy"
      @sign-in="signIn($event)"
      @sign-out="endSession()"
      @create-key="mintKey($event)"
      @revoke-key="revokeKey($event)"
    />

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the configuration" />

    <LoadingCard v-else-if="pending && data === null" />

    <UAlert
      v-else-if="!auth.isAdmin.value"
      color="neutral"
      variant="subtle"
      title="The rest of this screen belongs to an admin"
      description="How this org reaches GitHub, GitLab, Slack and cat-factory, and the keys machines call it with, are an admin's to change. Ask one of them, or sign in to an org you administer."
    />

    <div v-else-if="data" class="flex flex-col gap-4">
      <VcsConnectionCard
        v-for="connection in data.connections.vcs"
        :key="connection.provider"
        :ref="bindHostCard(connection.provider)"
        :connection="connection"
        :pat-status="statusOf(vcsPatCredentialKey(connection.provider))"
        :api-base="api.apiBase"
        :busy="busy !== null"
        @install-app="
          connect(api.startGitHubAppInstall, 'Could not start the App install', 'github-app')
        "
        @sign-in="
          connect(
            () => api.startSignIn(connection.provider),
            'Could not start the sign-in',
            `${connection.provider}-sign-in`,
          )
        "
        @sign-out="signOut(connection.provider)"
        @save-pat="
          save(
            vcsPatCredentialKey(connection.provider),
            $event,
            hostCards[connection.provider] ?? null,
          )
        "
        @clear-pat="clear(vcsPatCredentialKey(connection.provider))"
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
          description="The instance AI reviews are delegated to. The key needs cat-factory's decide scope rather than just write: a review parks on its findings, so a key that could not answer one is refused when the review is filed. The key alone is not enough either, since the deployment also needs a base URL and a service id, and until it has both this credential is stored and unused."
          @save="save('cat-factory', $event, catFactory)"
          @clear="clear('cat-factory')"
        />
      </UCard>
    </div>
  </UContainer>
</template>
