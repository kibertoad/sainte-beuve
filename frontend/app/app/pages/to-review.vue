<script setup lang="ts">
import type { PullRequestToReview } from '@sainte-beuve/contracts'

// The open pull requests in the linked repositories the viewer is best placed to
// review next. The server ranks them; this shows the order and why.
const api = useSainteBeuveApi()
const route = useRoute()
const router = useRouter()

// Dependency bots are hidden by default. The choice lives in the URL, like the My PRs filters.
const showDependencyBots = ref(route.query.dependencyBots === 'show')
watch(showDependencyBots, (show) => {
  void router.replace({ query: { ...route.query, dependencyBots: show ? 'show' : undefined } })
})

const { data, pending, error, refresh } = useAsyncData(
  'to-review',
  () =>
    api.listPullRequestsToReview({ dependencyBots: showDependencyBots.value ? 'show' : 'hide' }),
  { lazy: true, watch: [showDependencyBots] },
)

const unreadable = computed(() => data.value?.sources.filter((source) => !source.ok) ?? [])
const { busy, run } = useApiAction({ refresh })

async function takeOn(pr: PullRequestToReview) {
  await run(
    () => api.commitToPullRequest(pr.pullRequest, pr.title),
    'Could not record the commitment',
    pr.pullRequest.url,
  )
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">PRs to review</h1>
        <p class="text-sm text-muted">
          Open pull requests in the linked repositories you are best placed to review next.
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="ghost"
        class="shrink-0"
        :loading="pending"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </div>

    <div class="flex flex-col gap-3 mb-4 sm:flex-row sm:flex-wrap sm:items-end">
      <USwitch v-model="showDependencyBots" label="Show Dependabot and Renovate" />
    </div>

    <LoadingSpinner v-if="pending && data !== undefined" label="Updating…" class="mb-3" />

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the pull requests to review" />

    <LoadingCard v-else-if="data === undefined" />

    <div v-else-if="data" class="flex flex-col gap-4">
      <UAlert
        v-for="source in unreadable"
        :key="source.projectId"
        color="warning"
        variant="subtle"
        :title="`${source.owner}/${source.repo} could not be read`"
        :description="source.reason ?? 'No reason given.'"
      />

      <PullRequestList
        title="Best first"
        description="The ones you committed to lead, then the ones waiting longest for a review."
        empty="Nothing in the linked repositories is waiting on a review."
        :pull-requests="data.pullRequests"
      >
        <template #details="{ pullRequest }">
          <div class="flex flex-wrap gap-1 mt-1.5">
            <UBadge
              v-for="chip in toReviewChips(pullRequest.reasons)"
              :key="chip.label"
              size="sm"
              variant="subtle"
              :color="chip.color"
              class="max-w-full"
            >
              {{ chip.label }}
            </UBadge>
          </div>
        </template>
        <template #actions="{ pullRequest }">
          <UButton
            v-if="pullRequest.reasons.committedAt === null"
            size="sm"
            variant="ghost"
            :loading="busy === pullRequest.pullRequest.url"
            @click="takeOn(pullRequest)"
          >
            I will review it
          </UButton>
        </template>
      </PullRequestList>
    </div>
  </UContainer>
</template>
