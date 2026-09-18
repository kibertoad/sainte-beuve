<script setup lang="ts">
import type { IntegrationTokenStatus, SlackConnection } from '@sainte-beuve/contracts'

// Where the nudge arrives. Two halves that are configured separately and fail
// separately: a bot token to post OUT, and a signing secret to trust what comes
// back IN. A card reporting one flag would call a half-wired workspace healthy.
//
// Both are this ORG's, which is what makes the Request URL below worth showing
// rather than quoting from a constant: one Slack app serves one tenancy, and the
// slug in that URL is what places a command on this board rather than another's.
const props = defineProps<{
  connection: SlackConnection
  tokenStatus: IntegrationTokenStatus
  signingSecretStatus: IntegrationTokenStatus
  apiBase: string
  busy?: boolean
}>()

const emit = defineEmits<{
  save: [token: string]
  clear: []
  saveSigningSecret: [secret: string]
  clearSigningSecret: []
}>()

/** What the page needs of a credential input: a way to clear the draft in it. */
interface DraftHolder {
  clearDraft: () => void
}

const tokenField = ref<DraftHolder | null>(null)
const secretField = ref<DraftHolder | null>(null)

// TWO holders rather than one `clearDraft`, because this card holds two
// credentials and only the page knows which call succeeded: one exposure would
// let a stored bot token wipe a signing secret somebody had just pasted beside
// it. Each is a stable object over the field ref, so the page can hold it.
defineExpose({
  token: { clearDraft: () => tokenField.value?.clearDraft() },
  signingSecret: { clearDraft: () => secretField.value?.clearDraft() },
})

const requestUrl = computed(() => `${props.apiBase}${props.connection.requestPath}`)

const badge = computed(() =>
  props.connection.ready
    ? { color: 'success' as const, label: 'Delivering' }
    : { color: 'neutral' as const, label: 'Not configured' },
)
</script>

<template>
  <UCard>
    <div
      class="flex flex-col-reverse gap-2 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <div class="min-w-0">
        <p class="font-medium">Slack</p>
        <p class="text-sm text-muted">
          Announcements for new reviews, the reminder nudges, and the
          <code>/review</code> command.
        </p>
      </div>
      <UBadge :color="badge.color" variant="subtle" class="self-start sm:shrink-0">
        {{ badge.label }}
      </UBadge>
    </div>

    <UAlert
      v-if="connection.ready && connection.announcementChannelId === null"
      class="mb-4"
      color="info"
      variant="subtle"
      title="Reminders go out, announcements do not"
      description="A new review is announced in one channel, and this deployment has not named one. Set SLACK_CHANNEL_ID to turn announcements on."
    />

    <CredentialField
      ref="tokenField"
      :status="tokenStatus"
      :busy="busy"
      placeholder="xoxb-…"
      description="The bot token messages are posted with. Sealed before it is stored and never shown again."
      @save="emit('save', $event)"
      @clear="emit('clear')"
    />

    <USeparator class="my-4" />

    <CredentialField
      ref="secretField"
      :status="signingSecretStatus"
      :busy="busy"
      placeholder="8f742…"
      description="The signing secret from the same Slack app, which is what a slash command and a button press are trusted by. It belongs to this org: a command signed with it acts on this board and no other."
      @save="emit('saveSigningSecret', $event)"
      @clear="emit('clearSigningSecret')"
    />

    <USeparator class="my-4" />

    <div class="text-sm">
      <p class="font-medium mb-1">What the Slack app has to be told</p>
      <UAlert
        v-if="!connection.interactivityReady"
        class="mb-3"
        color="warning"
        variant="subtle"
        title="The command and the buttons are refused"
        description="A slash command and a button press can only be trusted once the signing secret from the Slack app configuration is stored above — or, for the default org alone, set as SLACK_SIGNING_SECRET on the deployment. Both are answered 503 until then, whether or not a bot token is stored."
      />
      <dl
        class="grid grid-cols-1 gap-x-4 gap-y-1 text-muted sm:grid-cols-[10rem_1fr] [&_code]:break-all"
      >
        <dt class="font-medium text-default sm:font-normal sm:text-muted">Request URL</dt>
        <dd>
          <code>{{ requestUrl }}</code>
        </dd>
        <dt class="font-medium text-default sm:font-normal sm:text-muted">Slash command</dt>
        <dd><code>/review</code>, pointed at the same URL</dd>
        <dt class="font-medium text-default sm:font-normal sm:text-muted">Announcements</dt>
        <dd>
          <code v-if="connection.announcementChannelId">
            {{ connection.announcementChannelId }}
          </code>
          <span v-else>no channel configured</span>
        </dd>
      </dl>
    </div>
  </UCard>
</template>
