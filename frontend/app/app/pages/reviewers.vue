<script setup lang="ts">
import type { Reviewer } from '@sainte-beuve/contracts'
import { knownHandles } from '@sainte-beuve/contracts'

// The reviewer directory: who is in the pool, what they can take, and which
// team an attention request can keep an ask inside.
const api = useSainteBeuveApi()
const { data, pending, refresh } = await useAsyncData('reviewers', () => api.listReviewers())

const reviewers = computed<Reviewer[]>(() => data.value?.reviewers ?? [])

/**
 * Every host account the person is known by. Shown as a list rather than as one
 * login, because that is what makes a workspace find their pull requests: a
 * reviewer with no handle on the host a project lives on is invisible there,
 * and this is the only screen that says so.
 */
function handles(reviewer: Reviewer): string {
  const known = knownHandles(reviewer.handles)
  return known.length === 0 ? 'no host account' : known.join(', ')
}
</script>

<template>
  <UContainer class="py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold">Reviewers</h1>
      <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="pending" @click="refresh()">
        Refresh
      </UButton>
    </div>

    <UCard v-if="reviewers.length === 0">
      <p class="text-sm text-muted">Nobody is in the pool yet.</p>
    </UCard>

    <div v-else class="flex flex-col gap-3">
      <UCard v-for="reviewer in reviewers" :key="reviewer.id">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="font-medium">{{ reviewer.displayName }}</p>
            <p class="text-sm text-muted">
              {{ handles(reviewer) }}
              <template v-if="reviewer.team"> &middot; {{ reviewer.team }}</template>
            </p>
            <div class="flex gap-1 mt-2">
              <UBadge v-for="skill in reviewer.skills" :key="skill" variant="subtle" size="sm">
                {{ skill }}
              </UBadge>
            </div>
          </div>
          <div class="text-right">
            <UBadge
              :color="reviewer.availability === 'available' ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ reviewer.availability }}
            </UBadge>
            <p class="text-xs text-muted mt-1">{{ reviewer.outstandingReviews }} outstanding</p>
          </div>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
