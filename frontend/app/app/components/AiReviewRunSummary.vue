<script setup lang="ts">
import type { AiReviewRun } from '@sainte-beuve/contracts'
import { activityLine } from '../utils/aiReviewPlan'
import { aiReviewStatusColor, aiReviewStatusLabel } from '../utils/aiReviewStatus'

// One AI review run in a line: where it stands and how to get to it. What a
// board row shows, and what the review screen lists its earlier runs as.
const props = defineProps<{
  run: AiReviewRun
  /** Where Open goes. Without one, Open emits instead, for a screen that switches in place. */
  to?: string
}>()

const emit = defineEmits<{ open: [] }>()

const line = computed(() => {
  const moving = activityLine(props.run)
  if (moving !== null) return moving
  const found = props.run.curation?.findings.length ?? 0
  if (props.run.status === 'awaiting_selection') {
    return `${found} finding${found === 1 ? '' : 's'} to decide on.`
  }
  return props.run.failureReason ?? props.run.summary ?? null
})
</script>

<template>
  <div
    class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
  >
    <div class="min-w-0 flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :color="aiReviewStatusColor[run.status]" variant="subtle">
          {{ aiReviewStatusLabel[run.status] }}
        </UBadge>
        <span class="text-xs text-muted">
          filed {{ new Date(run.requestedAt).toLocaleString() }}
        </span>
      </div>
      <p v-if="line" class="text-sm text-muted line-clamp-2">{{ line }}</p>
    </div>
    <UButton
      size="sm"
      :variant="run.status === 'awaiting_selection' ? 'solid' : 'soft'"
      :to="to"
      icon="i-lucide-arrow-right"
      trailing
      class="self-start sm:self-auto sm:shrink-0"
      @click="to === undefined && emit('open')"
    >
      {{ run.status === 'awaiting_selection' ? 'Decide' : 'Open' }}
    </UButton>
  </div>
</template>
