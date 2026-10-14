<script setup lang="ts">
import type { ReportWindow } from '@sainte-beuve/contracts'
import { DEFAULT_REPORT_WINDOW, reportWindowSchema } from '@sainte-beuve/contracts'

// How long pull requests wait for a review, a human review, an approval and a
// merge, across the linked repositories or in one of them. Read from the hosts
// on every load, so it covers history from before this deployment existed.
const api = useSainteBeuveApi()
const route = useRoute()
const router = useRouter()

/** USelect cannot hold an empty value, so "every repository" travels as this. */
const ALL = '__all__'

const windows = reportWindowSchema.options.map((value) => ({
  label: `Last ${value} days`,
  value,
}))

function queryValue(key: string): string | undefined {
  const value = route.query[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const days = ref<ReportWindow>(
  windows.find((option) => option.value === queryValue('days'))?.value ?? DEFAULT_REPORT_WINDOW,
)
const projectId = ref(queryValue('projectId') ?? ALL)

// In the URL, so a report on one repository can be linked to.
watch([days, projectId], () => {
  void router.replace({
    query: {
      days: days.value === DEFAULT_REPORT_WINDOW ? undefined : days.value,
      projectId: projectId.value === ALL ? undefined : projectId.value,
    },
  })
})

const projects = useAsyncData('reports-projects', () => api.listProjects(), { lazy: true })

const projectOptions = computed(() => [
  { label: 'All linked repositories', value: ALL },
  ...(projects.data.value?.projects ?? []).map((project) => ({
    label: `${project.owner}/${project.repo}`,
    value: project.id,
  })),
])

const { data, pending, error, refresh } = useAsyncData(
  'review-report',
  () =>
    api.getReviewReport({
      days: days.value,
      projectId: projectId.value === ALL ? undefined : projectId.value,
    }),
  { lazy: true, watch: [days, projectId] },
)

const unreadable = computed(() => data.value?.sources.filter((source) => !source.ok) ?? [])
const truncated = computed(() => data.value?.sources.filter((source) => source.truncated) ?? [])

const repositoriesById = computed(
  () => new Map((data.value?.repositories ?? []).map((entry) => [entry.projectId, entry])),
)
const hotspotKeys = computed(
  () => new Set((data.value?.hotspots ?? []).map((spot) => `${spot.projectId}:${spot.milestone}`)),
)

function nameOf(id: string): string {
  const repository = repositoriesById.value.get(id)
  return repository === undefined ? id : repositoryName(repository)
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Reports</h1>
        <p class="text-sm text-muted">
          How long pull requests opened in the window waited for each review milestone, from when
          they were ready for review.
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
      <UFormField label="Window">
        <USelect v-model="days" :items="windows" value-key="value" class="w-full sm:w-48" />
      </UFormField>
      <UFormField label="Repository">
        <USelect
          v-model="projectId"
          :items="projectOptions"
          value-key="value"
          class="w-full sm:w-64"
        />
      </UFormField>
    </div>

    <LoadingSpinner v-if="pending && data !== undefined" label="Updating…" class="mb-3" />

    <ApiErrorAlert v-if="error" :error="error" title="Could not build the report" />

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
      <UAlert
        v-for="source in truncated"
        :key="`truncated-${source.projectId}`"
        color="info"
        variant="subtle"
        :title="`${source.owner}/${source.repo} has more history than one read follows`"
        description="The oldest part of the window is missing from it. A shorter window covers it in full."
      />

      <p class="text-sm text-muted">
        {{ data.pullRequests }} pull requests opened in the last {{ data.days }} days, drafts left
        out.
      </p>

      <ReviewMetricCards :metrics="data.metrics" />

      <UCard v-if="data.projectId === null">
        <template #header>
          <h2 class="font-semibold">Hotspots</h2>
          <p class="text-sm text-muted">
            Repositories well behind the rest, or with pull requests left waiting.
          </p>
        </template>
        <p v-if="data.hotspots.length === 0" class="text-sm text-muted">
          No repository stands out.
        </p>
        <ul v-else class="divide-y divide-default">
          <li
            v-for="spot in data.hotspots"
            :key="`${spot.projectId}:${spot.milestone}`"
            class="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div class="min-w-0">
              <p class="font-medium truncate">{{ nameOf(spot.projectId) }}</p>
              <p class="text-sm text-muted">{{ hotspotSummary(spot) }}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <UBadge
                :color="spot.reason === 'stalled' ? 'error' : 'warning'"
                variant="subtle"
                size="sm"
              >
                {{ spot.reason === 'stalled' ? 'Stalled' : 'Slow' }}
              </UBadge>
              <UButton size="sm" variant="ghost" @click="projectId = spot.projectId">
                Open
              </UButton>
            </div>
          </li>
        </ul>
      </UCard>

      <ReportRepositoryTable
        v-if="data.projectId === null"
        :repositories="data.repositories"
        :hotspot-keys="hotspotKeys"
        @select="(id) => (projectId = id)"
      />

      <ReportPeopleTable :people="data.people" />

      <UCard>
        <template #header>
          <h2 class="font-semibold">Longest waits for a human review</h2>
          <p class="text-sm text-muted">Finished or still waiting, longest first.</p>
        </template>
        <p v-if="data.slowest.length === 0" class="text-sm text-muted">Nothing in the window.</p>
        <ul v-else class="divide-y divide-default">
          <li
            v-for="pr in data.slowest"
            :key="pr.url"
            class="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div class="min-w-0">
              <ULink :to="pr.url" target="_blank" class="font-medium truncate block">
                {{ pr.title }}
              </ULink>
              <p class="text-xs text-muted truncate">
                {{ nameOf(pr.projectId) }}#{{ pr.number }}
                <template v-if="pr.authorLogin">by {{ pr.authorLogin }}</template>
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="tabular-nums">{{ formatDuration(pr.waitMs) }}</span>
              <UBadge v-if="pr.waiting" color="warning" variant="subtle" size="sm">
                Still waiting
              </UBadge>
            </div>
          </li>
        </ul>
      </UCard>
    </div>
  </UContainer>
</template>
