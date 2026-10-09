<script setup lang="ts">
import type { MyReview, PullRequestRef } from '@sainte-beuve/contracts'
import { formatPullRequestRef, vcsDisplayName } from '@sainte-beuve/contracts'

// Other people's pull requests you have a part in: asked to review, committed
// to here, or reviewed already. Like My PRs, a repository nobody linked is
// listed too, with a button to link it.
const api = useSainteBeuveApi()
const route = useRoute()
const router = useRouter()

/** USelect cannot hold an empty value, so "no filter" travels as this. */
const ALL = '__all__'

function queryValue(key: string): string | undefined {
  const value = route.query[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const owner = ref(queryValue('owner') ?? ALL)
const linkedOnly = ref(queryValue('scope') === 'linked')

// The filters live in the URL, so a filtered view can be bookmarked and shared.
watch([owner, linkedOnly], () => {
  void router.replace({
    query: {
      owner: owner.value === ALL ? undefined : owner.value,
      scope: linkedOnly.value ? 'linked' : undefined,
    },
  })
})

const projects = useAsyncData('my-reviews-projects', () => api.listProjects(), { lazy: true })

const { data, pending, error, refresh } = useAsyncData(
  'my-reviews',
  () =>
    api.listMyReviews({
      owner: owner.value === ALL ? undefined : owner.value,
      scope: linkedOnly.value ? 'linked' : 'all',
    }),
  { lazy: true, watch: [owner, linkedOnly] },
)

// The owners of the linked projects and of whatever is listed, so an owner
// nobody linked can be filtered to as well.
const ownerOptions = computed(() => {
  const listed = [
    ...(data.value?.requested ?? []),
    ...(data.value?.committed ?? []),
    ...(data.value?.reviewed ?? []),
  ].map((row) => row.pullRequest.owner)
  const linked = (projects.data.value?.projects ?? []).map((project) => project.owner)
  const chosen = owner.value === ALL ? [] : [owner.value]
  const owners = [...new Set([...linked, ...listed, ...chosen])].sort()
  return [{ label: 'All owners', value: ALL }, ...owners.map((value) => ({ label: value, value }))]
})

const unreadable = computed(() => data.value?.sources.filter((source) => !source.ok) ?? [])
const unsearched = computed(() => data.value?.searches.filter((search) => !search.ok) ?? [])
const { busy, run } = useApiAction({ refresh })

async function refreshAfterLink() {
  await Promise.all([refresh(), projects.refresh()])
}

async function takeOn(pr: MyReview) {
  await run(
    () => api.commitToPullRequest(pr.pullRequest, pr.title),
    'Could not record the commitment',
    pr.pullRequest.url,
  )
}

async function release(commitmentId: string) {
  await run(
    () => api.releaseCommitment(commitmentId),
    'Could not release the commitment',
    commitmentId,
  )
}

function committedTo(pullRequest: PullRequestRef): boolean {
  return (data.value?.committed ?? []).some(
    (commitment) => commitment.pullRequest.url === pullRequest.url,
  )
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">My Reviews</h1>
        <p class="text-sm text-muted">
          Open pull requests you were asked to review, committed to, or reviewed already.
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
      <UFormField label="Owner">
        <USelect v-model="owner" :items="ownerOptions" value-key="value" class="w-full sm:w-48" />
      </UFormField>
      <USwitch v-model="linkedOnly" label="Linked repositories only" class="sm:pb-1.5" />
    </div>

    <ApiErrorAlert v-if="error" :error="error" title="Could not read your reviews" />

    <LoadingCard v-else-if="pending && data === null" />

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
        v-for="search in unsearched"
        :key="search.provider"
        color="warning"
        variant="subtle"
        :title="`${vcsDisplayName(search.provider)} could not be searched for your reviews`"
        :description="search.reason ?? 'No reason given.'"
      />

      <PullRequestList
        title="Asked to review"
        description="The host is waiting on your review."
        empty="Nobody is waiting on you."
        :pull-requests="data.requested"
      >
        <template #actions="{ pullRequest }">
          <LinkRepositoryButton
            v-if="pullRequest.projectId === null"
            :pull-request="pullRequest.pullRequest"
            @linked="refreshAfterLink"
          />
          <UButton
            v-if="!committedTo(pullRequest.pullRequest)"
            size="sm"
            variant="ghost"
            :loading="busy === pullRequest.pullRequest.url"
            @click="takeOn(pullRequest)"
          >
            I will review it
          </UButton>
        </template>
      </PullRequestList>

      <UCard>
        <template #header>
          <div class="flex items-baseline justify-between gap-3">
            <div>
              <h2 class="font-medium">Committed to reviewing</h2>
              <p class="text-sm text-muted">
                Promises you made here, whether or not the host knows about them.
              </p>
            </div>
            <UBadge variant="subtle" color="neutral">{{ data.committed.length }}</UBadge>
          </div>
        </template>
        <p v-if="data.committed.length === 0" class="text-sm text-muted">
          You have not taken anything on.
        </p>
        <div v-else class="flex flex-col divide-y divide-default">
          <div
            v-for="commitment in data.committed"
            :key="commitment.id"
            class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
          >
            <div class="min-w-0">
              <ULink
                :to="safeHref(commitment.pullRequest.url)"
                target="_blank"
                class="font-medium line-clamp-2"
              >
                {{ commitment.title }}
              </ULink>
              <p class="text-xs text-muted">{{ formatPullRequestRef(commitment.pullRequest) }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2 sm:shrink-0">
              <LinkRepositoryButton
                v-if="commitment.projectId === null"
                :pull-request="commitment.pullRequest"
                @linked="refreshAfterLink"
              />
              <UButton
                size="sm"
                variant="ghost"
                color="neutral"
                :loading="busy === commitment.id"
                @click="release(commitment.id)"
              >
                Hand back
              </UButton>
              <UButton
                :to="safeHref(commitment.pullRequest.url)"
                target="_blank"
                size="sm"
                variant="ghost"
                icon="i-lucide-external-link"
              >
                Review
              </UButton>
            </div>
          </div>
        </div>
      </UCard>

      <PullRequestList
        title="Reviewed"
        description="Still open, and you have reviewed them. One you are asked to look at again moves up."
        empty="Nothing you reviewed is still open."
        :pull-requests="data.reviewed"
      >
        <template #actions="{ pullRequest }">
          <LinkRepositoryButton
            v-if="pullRequest.projectId === null"
            :pull-request="pullRequest.pullRequest"
            @linked="refreshAfterLink"
          />
        </template>
      </PullRequestList>
    </div>
  </UContainer>
</template>
