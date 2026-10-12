<script setup lang="ts">
import type { RepositorySync } from '@sainte-beuve/contracts'

// How this org's repository list follows its cat-factory workspaces. Shown only
// while cat-factory is configured, which is when the list comes from there.
const props = defineProps<{ sync: RepositorySync; busy?: boolean }>()
const emit = defineEmits<{ sync: [] }>()

const WEBHOOK = {
  registered: { color: 'success', label: 'Pushed by cat-factory' },
  failed: { color: 'warning', label: 'Polled only' },
  pending: { color: 'neutral', label: 'Not synced yet' },
} as const satisfies Record<RepositorySync['webhook'], { color: string; label: string }>

const webhook = computed(() => WEBHOOK[props.sync.webhook])

function when(at: number | null): string {
  return at === null ? 'never' : new Date(at).toLocaleString()
}
</script>

<template>
  <UCard class="mt-4">
    <div
      class="flex flex-col-reverse gap-2 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <div class="min-w-0">
        <p class="font-medium">Repositories</p>
        <p class="text-sm text-muted">
          This org watches the repositories linked in its cat-factory workspaces. Link or unlink one
          there and it follows here; a repository cat-factory does not link is removed from the
          list. Skills, domains and merge settings stay editable on the Repositories screen.
        </p>
      </div>
      <UBadge :color="webhook.color" variant="subtle" class="self-start sm:shrink-0">
        {{ webhook.label }}
      </UBadge>
    </div>

    <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      <dt class="text-muted">Last synced</dt>
      <dd>{{ when(sync.syncedAt) }}</dd>
      <dt class="text-muted">Last full check</dt>
      <dd>{{ when(sync.reconciledAt) }}</dd>
      <template v-if="sync.webhookUrl">
        <dt class="text-muted">Push URL</dt>
        <dd class="break-all font-mono text-xs">{{ sync.webhookUrl }}</dd>
      </template>
    </dl>

    <UAlert
      v-if="sync.error"
      class="mt-3"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="The last sync did not complete"
      :description="sync.error"
    />
    <p v-if="sync.webhook === 'failed'" class="mt-3 text-sm text-muted">
      Changes are still picked up every few minutes. Pushes need a key with the
      <code>admin</code> scope that reaches every workspace, and a public HTTPS address for this
      deployment.
    </p>

    <UButton
      class="mt-4 w-full justify-center sm:w-auto"
      icon="i-lucide-refresh-cw"
      :loading="busy"
      @click="emit('sync')"
    >
      Sync now
    </UButton>
  </UCard>
</template>
