<script setup lang="ts">
import type { IntegrationTokenStatus, VcsConnection } from '@sainte-beuve/contracts'
import { signInCallbackPath, vcsDisplayName } from '@sainte-beuve/contracts'

// How this deployment reaches one source-control host. Several ways to
// connect, one of them in force, and the card's whole job is to say WHICH: a
// screen that only reported "GitHub: configured" would leave an operator with
// a stored token they cannot tell is being shadowed by an App.
//
// One component for every host. What differs between them is data the API
// already reports (`appInstallable`, `inboundIntake`, `availableMethods`), so a
// third host renders here with no change.
const props = defineProps<{
  connection: VcsConnection
  /** The pasted-token credential, so the card can offer that method too. */
  patStatus: IntegrationTokenStatus
  /**
   * The secret this org's webhooks are verified against, for a host whose intake
   * is configured per org (GitLab). Null for one whose secret is the
   * deployment's (GitHub's `GITHUB_WEBHOOK_SECRET`).
   */
  webhookSecretStatus?: IntegrationTokenStatus | null
  /** Where the API is served from, so the URLs to register can be shown. */
  apiBase: string
  busy?: boolean
}>()

const emit = defineEmits<{
  installApp: []
  signIn: []
  signOut: []
  savePat: [token: string]
  clearPat: []
  saveWebhookSecret: [secret: string]
  clearWebhookSecret: []
}>()

const pat = ref<{ clearDraft: () => void } | null>(null)
const secretField = ref<{ clearDraft: () => void } | null>(null)

// One holder per credential, so storing a token cannot clear a webhook secret
// somebody had just pasted beside it. The page clears whichever call landed.
defineExpose({
  pat: { clearDraft: () => pat.value?.clearDraft() },
  webhookSecret: { clearDraft: () => secretField.value?.clearDraft() },
})

const hostName = computed(() => vcsDisplayName(props.connection.provider))

const active = computed(() => vcsBadge(props.connection))

const offers = computed(() => ({
  // The install button follows `appInstallable`, not the method list: an App can
  // be the credential in force with no slug configured, and then there is no
  // install page to send anybody to.
  app: props.connection.appInstallable,
  oauth: props.connection.availableMethods.includes('oauth'),
  pat: props.connection.availableMethods.includes('pat'),
}))

/**
 * The URLs the host has to be given. Shown rather than described, because they
 * are typed into a form on the host by hand and a wrong one fails silently: the
 * host records a delivery nobody here ever sees.
 */
const webhookUrl = computed(() =>
  props.connection.webhookPath === null ? null : `${props.apiBase}${props.connection.webhookPath}`,
)

/** What turns an unverifiable intake into a working one, which differs per host. */
const webhookFix = computed(() =>
  props.webhookSecretStatus == null
    ? 'Nothing arriving from the host can be verified until GITHUB_WEBHOOK_SECRET matches the secret set on the App or repository webhook. Every delivery is answered 503 until then.'
    : 'Nothing arriving from the host can be verified until the secret token set on the GitLab webhook is stored above. Every delivery is refused until then.',
)
const callbackUrl = computed(
  () => `${props.apiBase}${signInCallbackPath(props.connection.provider)}`,
)

const shadowed = computed(
  () =>
    props.patStatus.state === 'stored' &&
    !props.patStatus.inUse &&
    props.connection.activeMethod !== null,
)

/**
 * What to do about a token that is stored and unread. Only a sign-in can be
 * dropped from this screen: an App and an environment token are deployment
 * configuration, so telling an operator to "disconnect" one names a button that
 * is not on the card.
 */
const shadowedAdvice = computed(() =>
  props.connection.activeMethod === 'oauth'
    ? 'Clear it, or disconnect above, to use it.'
    : 'Clear it, or take the stronger credential off the deployment, to use it.',
)
</script>

<template>
  <UCard>
    <div
      class="flex flex-col-reverse gap-2 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <div class="min-w-0">
        <p class="font-medium">{{ hostName }}</p>
        <p class="text-sm text-muted">
          Where a review starts, and where the verdict has to land. Pick whichever way of connecting
          suits the deployment: they are not exclusive, and the strongest one configured is the one
          calls are made with.
        </p>
      </div>
      <UBadge :color="active.color" variant="subtle" class="self-start sm:shrink-0">
        {{ active.label }}
      </UBadge>
    </div>

    <UAlert
      v-if="connection.availableMethods.length === 0"
      class="mb-4"
      color="warning"
      variant="subtle"
      :title="`This deployment cannot hold a ${hostName} credential yet`"
      description="Storing one needs an encryption key: set SETTINGS_ENCRYPTION_KEY, or set the host's token on the deployment to reach it straight from the environment."
    />

    <div v-if="offers.app || offers.oauth" class="flex flex-wrap items-center gap-2 mb-4">
      <UButton
        v-if="offers.app"
        icon="i-lucide-download"
        :loading="busy"
        @click="emit('installApp')"
      >
        Install the GitHub App
      </UButton>
      <UButton
        v-if="offers.oauth && connection.activeMethod !== 'oauth'"
        icon="i-lucide-log-in"
        color="neutral"
        variant="subtle"
        :loading="busy"
        @click="emit('signIn')"
      >
        Sign in with {{ hostName }}
      </UButton>
      <UButton
        v-if="connection.activeMethod === 'oauth'"
        icon="i-lucide-log-out"
        color="neutral"
        variant="ghost"
        :loading="busy"
        @click="emit('signOut')"
      >
        Disconnect
      </UButton>
    </div>

    <UAlert
      v-if="shadowed"
      class="mb-4"
      color="info"
      variant="subtle"
      title="The stored token is not the credential in use"
      :description="`${active.label}, so the personal access token below is stored and unread. ${shadowedAdvice}`"
    />

    <CredentialField
      v-if="offers.pat"
      ref="pat"
      :status="patStatus"
      :busy="busy"
      :placeholder="connection.provider === 'github' ? 'ghp_… or github_pat_…' : 'glpat-…'"
      description="A personal access token. The weakest way to connect: it is long-lived and carries whatever scopes the person who made it granted, which is why an app or a live sign-in takes precedence over it."
      @save="emit('savePat', $event)"
      @clear="emit('clearPat')"
    />

    <template v-if="webhookSecretStatus">
      <USeparator class="my-4" />
      <CredentialField
        ref="secretField"
        :status="webhookSecretStatus"
        :busy="busy"
        placeholder="The webhook's secret token"
        description="The secret token set on the GitLab webhook, which GitLab sends with every delivery. It belongs to this org: a delivery carrying it acts on this board and no other."
        @save="emit('saveWebhookSecret', $event)"
        @clear="emit('clearWebhookSecret')"
      />
    </template>

    <USeparator class="my-4" />

    <div class="text-sm">
      <p class="font-medium mb-1">What {{ hostName }} has to be told</p>
      <UAlert
        v-if="connection.inboundIntake && !connection.webhooksReady"
        class="mb-3"
        color="warning"
        variant="subtle"
        title="Inbound deliveries are refused"
        :description="webhookFix"
      />
      <dl
        class="grid grid-cols-1 gap-x-4 gap-y-1 text-muted sm:grid-cols-[10rem_1fr] [&_code]:break-all"
      >
        <template v-if="webhookUrl">
          <dt class="font-medium text-default sm:font-normal sm:text-muted">Webhook URL</dt>
          <dd>
            <code>{{ webhookUrl }}</code>
          </dd>
        </template>
        <dt class="font-medium text-default sm:font-normal sm:text-muted">Callback URL</dt>
        <dd>
          <code>{{ callbackUrl }}</code>
        </dd>
        <template v-if="connection.inboundIntake">
          <dt class="font-medium text-default sm:font-normal sm:text-muted">Bot mention</dt>
          <dd>
            <code v-if="connection.botLogin">@{{ connection.botLogin }} review</code>
            <span v-else-if="webhookSecretStatus == null"
              >not configured (set GITHUB_BOT_LOGIN to answer mentions)</span
            >
            <span v-else
              >off until the token stored here is a GitLab bot account (a project or group access
              token, or a service account): a person's own token would turn every mention of them
              into a command</span
            >
          </dd>
        </template>
      </dl>
    </div>

    <template v-if="connection.inboundIntake">
      <USeparator class="my-4" />

      <div class="text-sm">
        <p class="font-medium mb-1">Labels that do something</p>
        <dl
          class="grid grid-cols-1 gap-x-4 gap-y-1 text-muted sm:grid-cols-[10rem_1fr] [&_code]:break-all"
        >
          <dt>
            <code>{{ connection.labels.review }}</code>
          </dt>
          <dd>opens a review request and finds it a reviewer</dd>
          <dt>
            <code>{{ connection.labels.aiReview }}</code>
          </dt>
          <dd>hands the pull request to cat-factory</dd>
          <dt>
            <code>{{ connection.labels.skillPrefix }}payments</code>
          </dt>
          <dd>makes <code>payments</code> a skill the review wants</dd>
        </dl>
      </div>
    </template>
  </UCard>
</template>
