<script setup lang="ts">
import type { CapabilityName } from '@sainte-beuve/contracts'

// Shown where a feature needs an integration this org has not connected, so the
// button is not the first place somebody learns it cannot work.
const props = defineProps<{ need: CapabilityName }>()

/** What each capability is called, and what it is missing, in the Configuration screen's terms. */
const DESCRIPTORS: Record<CapabilityName, { title: string; missing: string }> = {
  aiReview: {
    title: 'AI review needs cat-factory',
    missing: 'This org has not connected cat-factory, or has no service to file AI reviews under.',
  },
  guidedReview: {
    title: 'Guided review needs cat-factory',
    missing: 'This org has not connected cat-factory.',
  },
}

const capabilities = useCapabilities()
const auth = useAuthState()

const descriptor = computed(() => DESCRIPTORS[props.need])
const missing = computed(() => !capabilities.available(props.need))
</script>

<template>
  <UAlert
    v-if="missing"
    color="warning"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    :title="descriptor.title"
  >
    <template #description>
      {{ descriptor.missing }}
      <template v-if="auth.isAdmin.value">
        Set it up on the
        <ULink to="/configuration/cat-factory" class="underline"
          >cat-factory configuration screen</ULink
        >.
      </template>
      <template v-else>Ask an admin of this org to set it up on the Configuration screen.</template>
    </template>
  </UAlert>
</template>
