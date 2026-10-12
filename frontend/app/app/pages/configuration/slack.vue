<script setup lang="ts">
import { callerIsAdmin, type DraftHolder } from '../../composables/useIntegrationSettings'

const { api, auth, data, pending, error, refresh, busy, statusOf, save, clear } =
  useIntegrationSettings()

const manifest = useAsyncData(
  'slack-app-manifest',
  async () => ((await callerIsAdmin(auth)) ? api.getSlackAppManifest() : null),
  { lazy: true },
)

function refreshAll() {
  return Promise.all([refresh(), manifest.refresh()])
}

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
    @refresh="refreshAll()"
  >
    <SlackConnectionCard
      v-if="data"
      ref="card"
      :connection="data.connections.slack"
      :token-status="statusOf('slack-bot-token')"
      :signing-secret-status="statusOf('slack-signing-secret')"
      :api-base="api.apiBase"
      :manifest="manifest.data.value ?? null"
      :manifest-error="manifest.error.value"
      :busy="busy !== null"
      @save="save('slack-bot-token', $event, card?.token ?? null)"
      @clear="clear('slack-bot-token')"
      @save-signing-secret="save('slack-signing-secret', $event, card?.signingSecret ?? null)"
      @clear-signing-secret="clear('slack-signing-secret')"
    />
  </IntegrationScreen>
</template>
