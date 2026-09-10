<script setup lang="ts">
import type { ReviewRequest } from '@sainte-beuve/contracts'

// The review board: everything in flight, and the two actions a viewer can take on
// each row. Deliberately one page for now: the shape of the board is the thing to
// get right first, and splitting it into components before it has any real content
// would be guessing at the seams.
const api = useSainteBeuveApi()
const { data, pending, error, refresh } = await useAsyncData('reviews', () => api.listReviews())

const reviews = computed<ReviewRequest[]>(() => data.value?.reviews ?? [])

type BadgeColor = 'error' | 'info' | 'success' | 'warning' | 'neutral'

const statusColor: Record<ReviewRequest['status'], BadgeColor> = {
  open: 'warning',
  assigned: 'info',
  in_review: 'info',
  approved: 'success',
  changes_requested: 'error',
  closed: 'neutral',
}

async function assign(review: ReviewRequest) {
  await api.assignReviewers(review.id)
  await refresh()
}

async function requestAiReview(review: ReviewRequest) {
  await api.requestAiReview(review.id)
  await refresh()
}
</script>

<template>
  <UContainer class="py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Reviews</h1>
        <p class="text-sm text-muted">Everything waiting on a human, and what it is waiting for.</p>
      </div>
      <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="pending" @click="refresh()">
        Refresh
      </UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not reach the sainte-beuve API"
      :description="`Tried ${api.apiBase}. Is the backend running?`"
    />

    <UCard v-else-if="reviews.length === 0">
      <p class="text-sm text-muted">
        Nothing is being reviewed. Open a pull request, or register one through the API.
      </p>
    </UCard>

    <div v-else class="flex flex-col gap-3">
      <UCard v-for="review in reviews" :key="review.id">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <ULink :to="review.pullRequest.url" target="_blank" class="font-medium">
              {{ review.pullRequest.owner }}/{{ review.pullRequest.repo }}#{{
                review.pullRequest.number
              }}
            </ULink>
            <p class="text-sm text-muted truncate">{{ review.title }}</p>
            <div class="flex gap-1 mt-2">
              <UBadge
                v-for="skill in review.requiredSkills"
                :key="skill"
                variant="subtle"
                size="sm"
              >
                {{ skill }}
              </UBadge>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <UBadge :color="statusColor[review.status]" variant="subtle">
              {{ review.status }}
            </UBadge>
            <UButton size="sm" variant="soft" @click="assign(review)">Find a reviewer</UButton>
            <UButton size="sm" variant="ghost" @click="requestAiReview(review)">AI review</UButton>
          </div>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
