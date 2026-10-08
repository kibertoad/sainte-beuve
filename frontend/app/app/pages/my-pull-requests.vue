<script setup lang="ts">
import type {
  MergeComment,
  MyPullRequest,
  MyPullRequestStatusFilter,
  Project,
} from '@sainte-beuve/contracts'
import { formatPullRequestRef, MY_PULL_REQUESTS_LIMIT } from '@sainte-beuve/contracts'

// The viewer's own open pull requests, ten at a time, and merging them: directly
// when the host would take it, or with a merge comment for a bot to act on.
const api = useSainteBeuveApi()
const { confirm } = useConfirm()
const toast = useToast()
const route = useRoute()
const router = useRouter()

/** USelect cannot hold an empty value, so "no filter" travels as this. */
const ALL = '__all__'

const statuses: { label: string; value: MyPullRequestStatusFilter }[] = [
  { label: 'Awaiting approval', value: 'awaiting' },
  { label: 'Approved', value: 'approved' },
  { label: 'Drafts', value: 'draft' },
]

function queryValue(key: string): string | undefined {
  const value = route.query[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const status = ref<MyPullRequestStatusFilter>(
  statuses.find((option) => option.value === queryValue('status'))?.value ?? 'awaiting',
)
const owner = ref(queryValue('owner') ?? ALL)
const projectId = ref(queryValue('projectId') ?? ALL)

// The filters live in the URL, so a filtered view can be bookmarked and shared.
watch([status, owner, projectId], () => {
  void router.replace({
    query: {
      status: status.value === 'awaiting' ? undefined : status.value,
      owner: owner.value === ALL ? undefined : owner.value,
      projectId: projectId.value === ALL ? undefined : projectId.value,
    },
  })
})

const projects = useAsyncData('my-pull-requests-projects', () => api.listProjects(), {
  lazy: true,
})

const ownerOptions = computed(() => {
  const owners = [...new Set((projects.data.value?.projects ?? []).map((p) => p.owner))].sort()
  return [{ label: 'All owners', value: ALL }, ...owners.map((value) => ({ label: value, value }))]
})

const projectOptions = computed(() => {
  const inScope = (projects.data.value?.projects ?? []).filter(
    (project: Project) => owner.value === ALL || project.owner === owner.value,
  )
  return [
    { label: 'All repositories', value: ALL },
    ...inScope.map((project) => ({ label: `${project.owner}/${project.repo}`, value: project.id })),
  ]
})

// A repository outside the chosen owner would filter to nothing, so it is let go.
watch(owner, () => {
  if (!projectOptions.value.some((option) => option.value === projectId.value)) {
    projectId.value = ALL
  }
})

const { data, pending, error, refresh } = useAsyncData(
  'my-pull-requests',
  () =>
    api.listMyPullRequests({
      status: status.value,
      owner: owner.value === ALL ? undefined : owner.value,
      projectId: projectId.value === ALL ? undefined : projectId.value,
    }),
  { lazy: true, watch: [status, owner, projectId] },
)

const unreadable = computed(() => data.value?.sources.filter((source) => !source.ok) ?? [])
const { busy, run } = useApiAction({ refresh })

async function merge(pr: MyPullRequest) {
  if (pr.status === null) return
  const override = pr.merge.direct === 'override'
  const confirmed = await confirm({
    title: `Merge ${formatPullRequestRef(pr.pullRequest)}?`,
    description: override
      ? 'This repository merges through its merge comments. As an admin you can merge it ' +
        'directly anyway, bypassing whatever the merge bot would have checked.'
      : 'It is merged on the host with the method the repository allows. This cannot be undone here.',
    confirmLabel: override ? 'Merge anyway' : 'Merge',
  })
  if (!confirmed) return
  await run(
    () =>
      api.mergeMyPullRequest({
        projectId: pr.projectId,
        number: pr.pullRequest.number,
        expectedHeadSha: pr.status?.headSha ?? '',
        override,
      }),
    'Could not merge the pull request',
    `${pr.pullRequest.url}:merge`,
  )
}

async function postComment(pr: MyPullRequest, comment: MergeComment) {
  const posted = await run(
    () => api.postMergeComment({ projectId: pr.projectId, number: pr.pullRequest.number, comment }),
    `Could not post "${comment.body}"`,
    `${pr.pullRequest.url}:${comment.label}`,
  )
  if (posted) toast.add({ color: 'success', title: `Posted "${comment.body}"` })
}

/** Merge comments are for a pull request that could merge once a bot is happy with it. */
function offersComments(pr: MyPullRequest): boolean {
  return pr.status?.state === 'open' && !pr.status.draft && pr.merge.comments.length > 0
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">My PRs</h1>
        <p class="text-sm text-muted">
          Your {{ MY_PULL_REQUESTS_LIMIT }} most recently updated open pull requests, and merging
          them.
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
      <UFormField label="Status">
        <USelect v-model="status" :items="statuses" value-key="value" class="w-full sm:w-48" />
      </UFormField>
      <UFormField label="Owner">
        <USelect v-model="owner" :items="ownerOptions" value-key="value" class="w-full sm:w-48" />
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

    <ApiErrorAlert v-if="error" :error="error" title="Could not read your pull requests" />

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

      <UCard>
        <p v-if="data.pullRequests.length === 0" class="text-sm text-muted">
          Nothing of yours matches these filters.
        </p>
        <div v-else class="flex flex-col divide-y divide-default">
          <div
            v-for="pr in data.pullRequests"
            :key="pr.pullRequest.url"
            class="flex flex-col gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div class="min-w-0">
                <ULink
                  :to="safeHref(pr.pullRequest.url)"
                  target="_blank"
                  class="font-medium line-clamp-2"
                >
                  {{ pr.title }}
                </ULink>
                <p class="text-xs text-muted">{{ formatPullRequestRef(pr.pullRequest) }}</p>
                <p v-if="pr.statusError" class="text-xs text-warning">{{ pr.statusError }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-2 sm:shrink-0">
                <UBadge variant="subtle" :color="mergeStateLabel(pr).color">
                  {{ mergeStateLabel(pr).label }}
                </UBadge>
                <UBadge v-if="pr.status?.approval === 'approved'" variant="subtle" color="success">
                  Approved
                </UBadge>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <template v-if="offersComments(pr)">
                <UButton
                  v-for="comment in pr.merge.comments"
                  :key="comment.label"
                  size="sm"
                  variant="soft"
                  icon="i-lucide-message-square"
                  :title="comment.body"
                  :loading="busy === `${pr.pullRequest.url}:${comment.label}`"
                  @click="postComment(pr, comment)"
                >
                  {{ comment.label }}
                </UButton>
              </template>
              <UButton
                v-if="pr.merge.direct === 'allowed' || pr.merge.direct === 'override'"
                size="sm"
                :color="pr.merge.direct === 'override' ? 'warning' : 'primary'"
                :variant="pr.merge.direct === 'override' ? 'soft' : 'solid'"
                icon="i-lucide-git-merge"
                :loading="busy === `${pr.pullRequest.url}:merge`"
                @click="merge(pr)"
              >
                {{ pr.merge.direct === 'override' ? 'Merge (admin override)' : 'Merge' }}
              </UButton>
              <span v-else-if="pr.merge.direct === 'restricted'" class="text-xs text-muted">
                This repository merges through its merge comments.
              </span>
              <UButton
                :to="safeHref(pr.pullRequest.url)"
                target="_blank"
                size="sm"
                variant="ghost"
                icon="i-lucide-external-link"
              >
                Open
              </UButton>
            </div>
          </div>
        </div>
      </UCard>

      <p v-if="!data.complete" class="text-sm text-muted">
        Only your most recently updated pull requests were checked. Narrow the filters to look
        further back.
      </p>
    </div>
  </UContainer>
</template>
