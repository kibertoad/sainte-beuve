<script setup lang="ts">
import type { OpenPullRequest } from '@sainte-beuve/contracts'
import { formatPullRequestRef } from '@sainte-beuve/contracts'

// The main working space: the three lists one person has to act on, and the
// asks waiting on an answer.
//
// You do not review here. Every row links OUT to the pull request on its host,
// because that is where the diff, the threads and the approve button live; what
// this screen is for is deciding what to open next, and telling the team when
// something needs eyes.
const api = useSainteBeuveApi()

const { data, pending, error, refresh } = await useAsyncData('workspace', async () => {
  const [workspace, projects] = await Promise.all([api.getWorkspace(), api.listProjects()])
  return { workspace, projects: projects.projects }
})

const attention = useAttentionStream()

const workspace = computed(() => data.value?.workspace ?? null)
const unreadable = computed(() => workspace.value?.sources.filter((source) => !source.ok) ?? [])

const { busy, run } = useApiAction({ refresh })
const { busy: askBusy, run: runAsk } = useApiAction({ refresh: attention.refresh })

/** The pull request the "ask for attention" dialog is open for. Null when closed. */
const asking = ref<OpenPullRequest | null>(null)

async function ask(request: {
  requiredSkills: string[]
  sameTeamOnly: boolean
  neededCommitments: number
  note: string | null
}) {
  const pr = asking.value
  if (pr === null) return
  const raised = await runAsk(
    () => api.requestAttention({ pullRequest: pr.pullRequest, title: pr.title, ...request }),
    'Could not ask for attention',
    pr.pullRequest.url,
  )
  if (raised) asking.value = null
}

async function commit(attentionId: string) {
  await runAsk(
    () => api.commitToAttention(attentionId),
    'Could not commit to the review',
    attentionId,
  )
  await refresh()
}

async function withdraw(attentionId: string) {
  await runAsk(
    () => api.cancelAttention(attentionId),
    'Could not withdraw the request',
    attentionId,
  )
}

async function takeOn(pr: OpenPullRequest) {
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
</script>

<template>
  <UContainer class="py-8">
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Workspace</h1>
        <p class="text-sm text-muted">
          <template v-if="workspace">
            Everything open across your projects, as {{ workspace.viewer.reviewer.displayName }}.
          </template>
          <template v-else>Everything open across your projects.</template>
        </p>
      </div>
      <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="pending" @click="refresh()">
        Refresh
      </UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :title="'This deployment could not build your workspace'"
      :description="apiErrorMessage(error)"
    />

    <div v-else-if="workspace" class="flex flex-col gap-4">
      <UAlert
        v-for="source in unreadable"
        :key="source.projectId"
        color="warning"
        variant="subtle"
        :title="`${source.owner}/${source.repo} could not be read`"
        :description="source.reason ?? 'No reason given.'"
      />

      <AttentionInbox
        :requests="attention.requests.value"
        :viewer-id="workspace.viewer.reviewer.id"
        :live="attention.live.value"
        :busy="askBusy"
        @commit="commit"
        @cancel="withdraw"
      />

      <PullRequestList
        title="Waiting on your review"
        description="Pull requests the host has formally asked you to review."
        empty="Nothing is waiting on you."
        :pull-requests="workspace.reviewRequested"
      >
        <template #actions="{ pullRequest }">
          <UButton
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
          <div class="flex items-baseline justify-between gap-4">
            <div>
              <h2 class="font-medium">You committed to reviewing</h2>
              <p class="text-sm text-muted">
                Promises you made here. They survive nobody having pressed the button on the host.
              </p>
            </div>
            <UBadge variant="subtle" color="neutral">{{ workspace.committed.length }}</UBadge>
          </div>
        </template>
        <p v-if="workspace.committed.length === 0" class="text-sm text-muted">
          You have not taken anything on.
        </p>
        <div v-else class="flex flex-col divide-y divide-default">
          <div
            v-for="commitment in workspace.committed"
            :key="commitment.id"
            class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <div class="min-w-0">
              <ULink :to="commitment.pullRequest.url" target="_blank" class="font-medium truncate">
                {{ commitment.title }}
              </ULink>
              <p class="text-xs text-muted">{{ formatPullRequestRef(commitment.pullRequest) }}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
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
                :to="commitment.pullRequest.url"
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
        title="Your open pull requests"
        description="What you have out. Ask for attention when one has been sitting too long."
        empty="You have nothing open."
        :pull-requests="workspace.authored"
      >
        <template #actions="{ pullRequest }">
          <UButton size="sm" variant="soft" @click="asking = pullRequest"
            >Ask for attention</UButton
          >
        </template>
      </PullRequestList>

      <UCard v-if="data && data.projects.length === 0">
        <p class="text-sm text-muted">
          No projects are registered, so there is nothing to sweep. Add one on the
          <ULink to="/projects">Projects</ULink> screen.
        </p>
      </UCard>
    </div>

    <RequestAttentionModal
      :pull-request="asking"
      :projects="data?.projects ?? []"
      :busy="askBusy !== null"
      @submit="ask"
      @close="asking = null"
    />
  </UContainer>
</template>
