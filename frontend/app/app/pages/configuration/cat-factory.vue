<script setup lang="ts">
import type { CatFactoryConfig } from '@sainte-beuve/contracts'
import type { DraftHolder } from '../../composables/useIntegrationSettings'

const { api, data, pending, error, refresh, busy, run, statusOf, save, clear } =
  useIntegrationSettings()
const { confirm } = useConfirm()
const capabilities = useCapabilities()

const card = ref<{ key: DraftHolder } | null>(null)

/** Whether saving this config moves the connection to another instance, which drops the stored key. */
function dropsKey(config: CatFactoryConfig): boolean {
  const stored = data.value?.connections.catFactory.config ?? null
  return (
    stored !== null &&
    stored.baseUrl !== config.baseUrl.replace(/\/+$/, '') &&
    statusOf('cat-factory').state !== 'absent'
  )
}

async function saveConfig(config: CatFactoryConfig) {
  const confirmed =
    !dropsKey(config) ||
    (await confirm({
      title: 'Move to another cat-factory instance?',
      description:
        'A key works only on the instance that minted it, so the stored key is removed. AI ' +
        'reviews already running on the old instance can no longer be followed.',
      confirmLabel: 'Change the base URL',
    }))
  if (!confirmed) return
  await run(
    () => api.saveCatFactoryConfig(config),
    'Could not save the cat-factory settings',
    'cat-factory-config',
  )
  await capabilities.refresh()
}

/** Forget this org's cat-factory connection, key included. */
async function clearConfig() {
  const confirmed = await confirm({
    title: 'Clear the cat-factory settings?',
    description:
      'The settings and the stored key are both removed. AI review and guided review stop ' +
      'working for this org until they are entered again.',
    confirmLabel: 'Clear the settings',
  })
  if (!confirmed) return
  await run(
    () => api.clearCatFactoryConfig(),
    'Could not clear the cat-factory settings',
    'cat-factory-config',
  )
  await capabilities.refresh()
}
</script>

<template>
  <IntegrationScreen
    title="cat-factory"
    description="The instance that runs this org's AI reviews and guided reviews."
    :pending="pending"
    :error="error"
    :loaded="data != null"
    @refresh="refresh()"
  >
    <CatFactoryConnectionCard
      v-if="data"
      ref="card"
      :connection="data.connections.catFactory"
      :key-status="statusOf('cat-factory')"
      :busy="busy !== null"
      @save="saveConfig($event)"
      @clear="clearConfig()"
      @save-key="save('cat-factory', $event, card?.key ?? null)"
      @clear-key="clear('cat-factory')"
    />
  </IntegrationScreen>
</template>
