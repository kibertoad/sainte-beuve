<script setup lang="ts">
import type { DraftHolder } from '../../composables/useIntegrationSettings'

const { api, data, pending, error, refresh, busy, statusOf, save, clear } = useIntegrationSettings()

/** Two holders, one per credential, so storing one cannot clear a draft of the other. */
const card = ref<{ token: DraftHolder; signingSecret: DraftHolder } | null>(null)
</script>

<template>
  <IntegrationScreen
    title="Slack"
    description="Where review requests are announced and reminders are sent."
    :pending="pending"
    :error="error"
    :loaded="data != null"
    @refresh="refresh()"
  >
    <SlackConnectionCard
      v-if="data"
      ref="card"
      :connection="data.connections.slack"
      :token-status="statusOf('slack-bot-token')"
      :signing-secret-status="statusOf('slack-signing-secret')"
      :api-base="api.apiBase"
      :busy="busy !== null"
      @save="save('slack-bot-token', $event, card?.token ?? null)"
      @clear="clear('slack-bot-token')"
      @save-signing-secret="save('slack-signing-secret', $event, card?.signingSecret ?? null)"
      @clear-signing-secret="clear('slack-signing-secret')"
    />
  </IntegrationScreen>
</template>
