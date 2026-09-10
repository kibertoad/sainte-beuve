<script setup lang="ts">
// The reviewer directory: who is in the pool and what they can take.
const api = useSainteBeuveApi()
const { data, pending, refresh } = await useAsyncData('reviewers', () => api.listReviewers())

const reviewers = computed(() => data.value?.reviewers ?? [])
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
            <p class="text-sm text-muted">{{ reviewer.githubLogin ?? 'no GitHub login' }}</p>
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
