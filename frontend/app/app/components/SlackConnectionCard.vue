<script setup lang="ts">
import type { IntegrationTokenStatus, SlackConnection } from '@sainte-beuve/contracts'

// Where the nudge arrives. Two halves that are configured separately and fail
// separately: a bot token to post OUT, and a signing secret to trust what comes
// back IN. A card reporting one flag would call a half-wired workspace healthy.
const props = defineProps<{
  connection: SlackConnection
  tokenStatus: IntegrationTokenStatus
  apiBase: string
  busy?: boolean
}>()

const emit = defineEmits<{ save: [token: string]; clear: [] }>()

const field = ref<{ clearDraft: () => void } | null>(null)

function clearDraft() {
  field.value?.clearDraft()
}

defineExpose({ clearDraft })

const requestUrl = computed(() => `${props.apiBase}/webhooks/slack`)

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
      ref="field"
      :status="tokenStatus"
      :busy="busy"
      placeholder="xoxb-…"
      description="The bot token messages are posted with. Sealed before it is stored and never shown again."
      @save="emit('save', $event)"
      @clear="emit('clear')"
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
        description="A slash command and a button press can only be trusted once SLACK_SIGNING_SECRET matches the signing secret in the Slack app configuration. Both are answered 503 until then, whether or not a bot token is stored."
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
