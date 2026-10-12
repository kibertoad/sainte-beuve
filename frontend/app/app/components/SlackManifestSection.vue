<script setup lang="ts">
import type { SlackAppManifestResult } from '@sainte-beuve/contracts'

// The Slack app this org needs, as a manifest Slack creates it from. Null while
// the read is in flight.
const props = defineProps<{
  result: SlackAppManifestResult | null
  error: unknown
}>()

const text = computed(() =>
  props.result?.status === 'ready' ? JSON.stringify(props.result.manifest, null, 2) : '',
)

const toast = useToast()

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    toast.add({ color: 'success', title: 'Manifest copied' })
  } catch {
    toast.add({ color: 'error', title: 'Could not copy the manifest' })
  }
}
</script>

<template>
  <div class="text-sm">
    <p class="font-medium mb-1">Create the Slack app</p>

    <ApiErrorAlert v-if="error" :error="error" title="Could not build the Slack app manifest" />

    <USkeleton v-else-if="result === null" class="h-24 w-full" />

    <UAlert
      v-else-if="result.status === 'unavailable'"
      color="warning"
      variant="subtle"
      title="No manifest until the API has a public https address"
      :description="result.missing"
    />

    <template v-else>
      <div class="flex flex-col gap-2 mb-2 sm:flex-row sm:items-start sm:justify-between">
        <p class="text-muted min-w-0">
          On
          <ULink to="https://api.slack.com/apps" target="_blank" class="text-primary">
            api.slack.com/apps
          </ULink>
          choose Create New App, then From a manifest, and paste this.
        </p>
        <UButton
          size="xs"
          variant="soft"
          icon="i-lucide-copy"
          class="self-start sm:shrink-0"
          @click="copy"
        >
          Copy manifest
        </UButton>
      </div>
      <pre
        class="max-h-64 overflow-auto rounded-md border border-default bg-elevated p-3 text-xs"
      ><code>{{ text }}</code></pre>
      <p class="text-muted mt-2">
        Install the app to the workspace, then paste its bot token (OAuth &amp; Permissions) and its
        signing secret (Basic Information) below.
      </p>
    </template>
  </div>
</template>
