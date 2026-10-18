<script setup lang="ts">
import type { AiReviewRun, ResolveAiReviewInput } from '@sainte-beuve/contracts'
import {
  AI_REVIEW_PATH,
  AI_REVIEW_RUN_QUERY,
  BOARD_REVIEW_QUERY,
  boardReviewPath,
  formatPullRequestRef,
} from '@sainte-beuve/contracts'
import { isInFlight, isWorking } from '../utils/aiReviewStatus'

// The AI reviews of one board row, followed and settled here: where each run
// stands, what it found, and what to do with every finding, without a trip to
// cat-factory's own app.
//
// The read POLLS: cat-factory calls nothing back, so this screen re-reads while
// anything can still move. Fast while a machine is working, slow while a run
// waits on a person, because a parked review changes only when somebody acts on
// it, and the action re-reads by itself.
const route = useRoute()
const router = useRouter()
const api = useSainteBeuveApi()
const { confirm } = useConfirm()

const reviewId = computed(() => {
  const value = route.query[BOARD_REVIEW_QUERY]
  return typeof value === 'string' && value.length > 0 ? value : null
})

const { data: review, error: reviewError } = useAsyncData(
  () => `ai-review-subject-${reviewId.value}`,
  () => (reviewId.value === null ? Promise.resolve(null) : api.getReview(reviewId.value)),
  { lazy: true },
)

const { data, pending, error, refresh } = useAsyncData(
  () => `ai-review-runs-${reviewId.value}`,
  () =>
    reviewId.value === null
      ? Promise.resolve({ runs: [] as AiReviewRun[] })
      : api.listAiReviewRuns(reviewId.value),
  { lazy: true },
)

const runs = computed<AiReviewRun[]>(() => data.value?.runs ?? [])
const focused = computed<AiReviewRun | null>(() => {
  const asked = route.query[AI_REVIEW_RUN_QUERY]
  return runs.value.find((entry) => entry.id === asked) ?? runs.value[0] ?? null
})
const earlier = computed(() => runs.value.filter((entry) => entry.id !== focused.value?.id))

const inFlight = computed(() => runs.value.some(isInFlight))
const working = computed(() => runs.value.some(isWorking))

const { busy, run: act } = useApiAction({ refresh })

usePolling(
  () => inFlight.value && busy.value === null,
  () => refresh(),
  () => (working.value ? 5000 : 30000),
)

function focus(runId: string): void {
  void router.replace({
    path: AI_REVIEW_PATH,
    query: { ...route.query, [AI_REVIEW_RUN_QUERY]: runId },
  })
}

async function requestAnother(): Promise<void> {
  const id = reviewId.value
  if (id === null) return
  await act(
    async () => focus((await api.requestAiReview(id)).id),
    'Could not request an AI review',
    'request',
  )
}

async function challenge(runId: string, findingId: string, question: string | null) {
  await act(
    () => api.challengeAiReviewFinding(runId, findingId, question),
    'Could not challenge it',
    `challenge:${findingId}`,
  )
}

async function resolve(runId: string, resolution: ResolveAiReviewInput, done: () => void) {
  if (resolution.action === 'finish' && !(await confirmClose(runId))) return
  const worked = await act(
    () => api.resolveAiReview(runId, resolution),
    resolution.action === 'finish' ? 'Could not close the review' : 'Could not apply your choices',
    'resolve',
  )
  if (worked) done()
}

/** Closing throws away what cat-factory found, so it asks, and says whether anything is lost. */
function confirmClose(runId: string): Promise<boolean> {
  const found = runs.value.find((entry) => entry.id === runId)?.curation?.findings.length ?? 0
  return confirm({
    title: found === 0 ? 'Close this review?' : `Close without acting on ${found} findings?`,
    description:
      found === 0
        ? 'There is nothing left to act on, so nothing is lost.'
        : 'Nothing is posted or fixed, and the findings are not kept. Running the review again is the only way to see them back.',
    confirmLabel: 'Close without posting',
  })
}

async function resume(runId: string): Promise<void> {
  await act(() => api.resumeAiReview(runId), 'Could not resume the review', 'resume')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <h1 class="text-xl font-semibold">AI review</h1>
      <p class="text-sm text-muted">
        cat-factory reviews the pull request and you decide what each finding deserves: a comment, a
        fix it commits for you, or nothing.
      </p>
    </div>

    <CapabilityWarning need="aiReview" />

    <UAlert
      v-if="reviewId === null"
      color="error"
      variant="subtle"
      title="No review named"
      description="Open an AI review from a pull request on the workspace or the board."
    />

    <template v-else>
      <UCard>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div v-if="review" class="min-w-0">
            <ULink :to="safeHref(review.pullRequest.url)" target="_blank" class="font-medium">
              {{ formatPullRequestRef(review.pullRequest) }}
            </ULink>
            <p class="text-sm text-muted line-clamp-2">{{ review.title }}</p>
            <p class="text-xs text-muted mt-1">opened by {{ review.authorLogin }}</p>
          </div>
          <p v-else-if="reviewError" class="text-sm text-muted">
            The pull request this review is about could not be read.
          </p>
          <USkeleton v-else class="h-10 w-full sm:w-64" />
          <div class="flex flex-wrap items-center gap-2 sm:shrink-0">
            <UButton :to="boardReviewPath(reviewId)" size="sm" variant="ghost" color="neutral">
              On the board
            </UButton>
            <UButton
              v-if="review"
              :to="guidedReviewRoute(review.pullRequest)"
              size="sm"
              variant="ghost"
            >
              Guided review
            </UButton>
            <UButton
              size="sm"
              icon="i-lucide-bot"
              :loading="busy === 'request'"
              :disabled="inFlight"
              @click="requestAnother"
            >
              {{ runs.length === 0 ? 'Start an AI review' : 'Review again' }}
            </UButton>
          </div>
        </div>
      </UCard>

      <ApiErrorAlert v-if="error" :error="error" title="Could not read the AI reviews" />
      <LoadingCard v-else-if="pending && data === undefined" :rows="3" />

      <UCard v-else-if="focused === null">
        <p class="text-sm">
          Nobody has asked cat-factory to review this pull request yet. It fans the diff out across
          parallel reviewers and comes back with findings for you to decide on. Nothing reaches the
          pull request until you do.
        </p>
      </UCard>

      <template v-else>
        <AiReviewRunCard
          :key="focused.id"
          :run="focused"
          :busy="busy"
          @challenge="(findingId, question) => challenge(focused!.id, findingId, question)"
          @resolve="(resolution, done) => resolve(focused!.id, resolution, done)"
          @resume="resume(focused!.id)"
        />

        <UCard v-if="earlier.length > 0" variant="outline">
          <template #header>
            <h2 class="text-sm font-semibold">Earlier runs</h2>
          </template>
          <div class="flex flex-col divide-y divide-default">
            <AiReviewRunSummary
              v-for="entry in earlier"
              :key="entry.id"
              :run="entry"
              @open="focus(entry.id)"
            />
          </div>
        </UCard>
      </template>
    </template>
  </div>
</template>
