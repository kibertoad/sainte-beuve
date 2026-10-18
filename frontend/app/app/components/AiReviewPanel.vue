<script setup lang="ts">
import type { AiReviewRun } from '@sainte-beuve/contracts'
import { aiReviewPath } from '@sainte-beuve/contracts'
import { isInFlight, isWorking } from '../utils/aiReviewStatus'

// Every AI review filed against one board row, newest first, in a line each.
// The findings are decided on the review screen, which this links to; the row
// only says where each run stands.
//
// The read POLLS while the row is open, for the reason the review screen does:
// cat-factory calls nothing back. Fast while a machine is working, slow while a
// run waits on a person, and not at all once everything has settled.
const props = defineProps<{ reviewId: string }>()

const api = useSainteBeuveApi()
// NOT awaited, and `lazy` for the same reason: this component mounts when a board
// row is expanded, and a suspending setup would blank the whole page while one
// row's reviews were fetched.
const { data, error, refresh } = useAsyncData(
  `ai-review-${props.reviewId}`,
  () => api.listAiReviewRuns(props.reviewId),
  { lazy: true },
)

const runs = computed<AiReviewRun[]>(() => data.value?.runs ?? [])

const inFlight = computed(() => runs.value.some(isInFlight))
const working = computed(() => runs.value.some(isWorking))

usePolling(
  () => inFlight.value,
  () => refresh(),
  () => (working.value ? 5000 : 30000),
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-muted">AI reviews of this pull request.</p>
      <UButton :to="aiReviewPath(reviewId)" size="xs" variant="ghost" icon="i-lucide-bot">
        Open the AI review
      </UButton>
    </div>

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the AI reviews" />

    <!--
      PENDING before empty. The read is lazy, so `runs` is empty while it is
      still in the air, and checking the length first told everybody who opened a
      row that nothing had been delegated for as long as the read took.
    -->
    <LoadingCard v-else-if="data === undefined" :rows="1" />

    <p v-else-if="runs.length === 0" class="text-sm text-muted">
      Nothing delegated yet. Press <span class="font-medium">AI review</span> to hand this pull
      request to cat-factory.
    </p>

    <div v-else class="flex flex-col divide-y divide-default">
      <AiReviewRunSummary
        v-for="entry in runs"
        :key="entry.id"
        :run="entry"
        :to="aiReviewPath(reviewId, entry.id)"
      />
    </div>
  </div>
</template>
