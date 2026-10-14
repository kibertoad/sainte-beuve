<script setup lang="ts">
import type { ReviewMetrics } from '@sainte-beuve/contracts'
import { REVIEW_MILESTONES } from '@sainte-beuve/contracts'

// One card per review milestone: the median large, the p90 and mean beside it,
// and how many pull requests the numbers are over.
defineProps<{ metrics: ReviewMetrics }>()
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <UCard v-for="milestone in REVIEW_MILESTONES" :key="milestone">
      <p class="text-sm font-medium">{{ MILESTONE_LABELS[milestone] }}</p>
      <p class="text-xs text-muted">{{ MILESTONE_DESCRIPTIONS[milestone] }}</p>
      <p class="mt-3 text-3xl font-semibold tabular-nums">
        {{ formatDuration(metrics[milestone].medianMs) }}
        <span class="text-sm font-normal text-muted">median</span>
      </p>
      <p class="mt-1 text-sm text-muted tabular-nums">
        p90 {{ formatDuration(metrics[milestone].p90Ms) }}, mean
        {{ formatDuration(metrics[milestone].meanMs) }}
      </p>
      <p class="mt-1 text-xs text-muted">{{ sampleLabel(metrics[milestone]) }}</p>
    </UCard>
  </div>
</template>
