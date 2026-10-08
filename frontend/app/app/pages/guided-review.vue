<script setup lang="ts">
import type { AskGuidedReviewInput, GuidedReviewSessionView } from '@sainte-beuve/contracts'
import { GUIDED_REVIEW_QUESTION_MAX } from '@sainte-beuve/contracts'

// A guided review of one pull request: cat-factory's explanation of it, the
// threads somebody has asked it questions in, and the comments it drafted.
//
// There is one per pull request on this deployment, shared by everybody who
// opens it. Opening the page READS; only the button starts one, because a new
// review spends model budget on the cat-factory side.
const route = useRoute()
const api = useSainteBeuveApi()
const toast = useToast()

const target = computed(() => targetFromQuery(route.query))
const prUrl = computed(() => prUrlFromQuery(route.query))

const { data, pending, error, refresh } = useAsyncData(
  () => `guided-review-${JSON.stringify(target.value)}`,
  async () => {
    if (target.value === null) return null
    return (await api.findGuidedReview(target.value)).session
  },
  { lazy: true },
)

const view = computed<GuidedReviewSessionView | null>(() => data.value ?? null)
const session = computed(() => view.value?.session ?? null)
const threads = computed(() => view.value?.threads ?? [])

// The stream keeps the view current; the poll is what a page without it falls
// back on, so it only runs while the stream is down.
const stream = useGuidedReviewStream(() => session.value?.id ?? null, {
  state: (next) => {
    data.value = next
  },
  deleted: () => {
    data.value = null
  },
})

usePolling(
  () => !stream.live.value && view.value !== null && isSessionWorking(view.value),
  () => refresh(),
  () => (view.value === null ? FAST_POLL_MS : sessionPollInterval(view.value)),
)

const activeThreadId = ref<string | null>(null)
watch(
  threads,
  (list) => {
    if (activeThreadId.value === null && list.length > 0) activeThreadId.value = list[0]?.id ?? null
  },
  { immediate: true },
)

const opening = ref(false)

/** Start the review, saying what to do about a refusal cat-factory gave a reason for. */
async function open(): Promise<void> {
  if (target.value === null) return
  opening.value = true
  try {
    data.value = await api.openGuidedReview(target.value)
  } catch (err) {
    toast.add({
      color: 'error',
      title: 'Could not start the guided review',
      description: refusalMessage(err),
    })
  } finally {
    opening.value = false
  }
}

const { busy, run } = useApiAction({ refresh })

async function refreshOverview(): Promise<void> {
  const id = session.value?.id
  if (id === undefined) return
  await run(() => api.refreshGuidedReview(id), 'Could not refresh the review', 'refresh')
}

const question = ref('')
const deep = ref(false)

/** A new line of inquiry: a thread of its own, opened on its first question. */
async function startThread(question: AskGuidedReviewInput): Promise<boolean> {
  const id = session.value?.id
  if (id === undefined) return false
  let opened: string | null = null
  const ok = await run(
    async () => {
      opened = (await api.openGuidedReviewThread(id, { question })).thread.id
    },
    'Could not ask the question',
    'thread',
  )
  if (opened !== null) activeThreadId.value = opened
  return ok
}

async function askNew(): Promise<void> {
  const content = question.value.trim()
  if (content.length === 0) return
  if (await startThread({ content, depth: deep.value ? 'deep' : 'inline' })) question.value = ''
}

/** What the active thread waits on, as the session last reported it. */
function pendingOf(threadId: string): string | null {
  return threads.value.find((thread) => thread.id === threadId)?.pendingMessageId ?? null
}

const overviewReady = computed(() => session.value?.overview.status === 'complete')
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <h1 class="text-xl font-semibold">Guided review</h1>
      <p class="text-sm text-muted">
        cat-factory explains the pull request and answers questions about it. You still review it on
        its host.
      </p>
    </div>

    <UAlert
      v-if="target === null"
      color="error"
      variant="subtle"
      title="No pull request named"
      description="Open a guided review from a pull request on the workspace or the board."
    />

    <template v-else>
      <UCard>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div class="min-w-0">
            <ULink :to="safeHref(prUrl)" target="_blank" class="font-medium">
              {{ target.owner }}/{{ target.repo }}#{{ target.number }}
            </ULink>
            <p v-if="session" class="text-sm text-muted line-clamp-2">{{ session.prTitle }}</p>
            <p v-if="session" class="text-xs text-muted mt-1">
              Read at
              <span class="font-mono">{{ session.reviewedHeadSha.slice(0, 7) }}</span>
              &middot; against {{ session.baseRef }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 sm:shrink-0">
            <UButton
              v-if="session"
              size="sm"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="busy === 'refresh'"
              @click="refreshOverview"
            >
              Re-read at the latest commit
            </UButton>
          </div>
        </div>
      </UCard>

      <ApiErrorAlert v-if="error" :error="error" title="Could not read the guided review" />
      <LoadingCard v-else-if="pending && data === undefined" :rows="3" />

      <UCard v-else-if="session === null">
        <div class="flex flex-col gap-3">
          <p class="text-sm">
            Nobody has started a guided review of this pull request yet. cat-factory reads it and
            explains what it does, what it risks and where to look first, then answers questions
            about it.
          </p>
          <div>
            <UButton icon="i-lucide-sparkles" :loading="opening" @click="open">
              Start a guided review
            </UButton>
          </div>
        </div>
      </UCard>

      <div v-else-if="session" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UCard>
          <template #header><h2 class="font-medium">Overview</h2></template>
          <GuidedReviewOverview
            :session="session"
            :pr-url="prUrl"
            :can-ask="busy === null"
            @ask="(content) => startThread({ content })"
          />
        </UCard>

        <div class="flex flex-col gap-4 min-w-0">
          <UCard>
            <template #header><h2 class="font-medium">Questions</h2></template>
            <div class="flex flex-col gap-4">
              <form class="flex flex-col gap-2" @submit.prevent="askNew">
                <UTextarea
                  v-model="question"
                  :rows="2"
                  autoresize
                  :maxlength="GUIDED_REVIEW_QUESTION_MAX"
                  :disabled="!overviewReady"
                  placeholder="Ask something new about this pull request"
                  class="w-full"
                />
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <USwitch v-model="deep" label="Dig into a checkout" :disabled="!overviewReady" />
                  <UButton
                    type="submit"
                    icon="i-lucide-message-circle-plus"
                    :loading="busy === 'thread'"
                    :disabled="!overviewReady || busy !== null || question.trim().length === 0"
                  >
                    New thread
                  </UButton>
                </div>
              </form>

              <div v-if="threads.length > 0" class="flex flex-wrap gap-1">
                <UButton
                  v-for="thread in threads"
                  :key="thread.id"
                  size="xs"
                  :variant="thread.id === activeThreadId ? 'soft' : 'ghost'"
                  :icon="thread.pendingMessageId ? 'i-lucide-loader-circle' : undefined"
                  :ui="{ leadingIcon: thread.pendingMessageId ? 'animate-spin' : '' }"
                  class="max-w-full"
                  @click="activeThreadId = thread.id"
                >
                  <span class="truncate">{{ thread.title || 'Untitled thread' }}</span>
                </UButton>
              </div>

              <GuidedReviewThread
                v-if="activeThreadId"
                :key="activeThreadId"
                :session="session"
                :thread-id="activeThreadId"
                :pending-message-id="pendingOf(activeThreadId)"
                :live="stream.live.value"
                :pr-url="prUrl"
                @changed="refresh()"
              />
            </div>
          </UCard>

          <UCard>
            <template #header><h2 class="font-medium">Comment drafts</h2></template>
            <GuidedReviewDrafts
              :session="session"
              :drafts="view?.drafts ?? []"
              :pr-url="prUrl"
              @changed="refresh()"
            />
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>
