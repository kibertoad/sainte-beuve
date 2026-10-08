<script setup lang="ts">
// The frame every integration screen shares: the way back to the list, the
// refresh, and the three states that replace the card (a failed read, the first
// read in flight, a caller who is not an admin). The card itself is the slot.
defineProps<{
  title: string
  description: string
  pending: boolean
  error: unknown
  /** The read has landed with something to render. */
  loaded: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const auth = useAuthState()
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <UButton
      to="/configuration"
      icon="i-lucide-arrow-left"
      variant="link"
      color="neutral"
      class="mb-4 px-0"
    >
      Configuration
    </UButton>

    <div class="mb-8">
      <h1 class="text-2xl font-semibold">{{ title }}</h1>
      <p class="text-sm text-muted">{{ description }}</p>
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
        @click="emit('refresh')"
      >
        Refresh
      </UButton>
    </div>

    <ApiErrorAlert v-if="error" :error="error" :title="`Could not read the ${title} settings`" />

    <LoadingCard v-else-if="pending && !loaded" :rows="1" />

    <UAlert
      v-else-if="!auth.isAdmin.value"
      color="neutral"
      variant="subtle"
      :title="`${title} is an admin's to configure`"
      description="Ask an admin of this org, or sign in to an org you administer."
    />

    <slot v-else-if="loaded" />
  </UContainer>
</template>
