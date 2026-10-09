<script setup lang="ts">
// A spinner with words beside it, so a screen waiting on a read says so.
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading…' })
</script>

<template>
  <div class="flex items-center gap-2 text-sm text-muted" role="status" aria-live="polite">
    <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
    <span>{{ label }}</span>
  </div>
</template>
