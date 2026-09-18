<script setup lang="ts">
import type { AiReviewResolution, AiReviewRun } from '@sainte-beuve/contracts'

// Every AI review filed against one pull request, newest first.
//
// The read POLLS: cat-factory drives the review asynchronously and calls nothing
// back, so opening this panel is how a person learns the reviewer has parked with
// findings. A run still in flight is re-read on an interval while the panel is
// open, and the interval stops with it, because a board with a dozen rows
// expanded would otherwise poll a dozen reviews for ever.
const props = defineProps<{ reviewId: string }>()

const api = useSainteBeuveApi()
// NOT awaited, and `lazy` for the same reason: this component mounts when a board
// row is expanded, and a suspending setup would blank the whole page while one
// row's reviews were fetched.
const { data, pending, error, refresh } = useAsyncData(
  `ai-review-${props.reviewId}`,
  () => api.listAiReviewRuns(props.reviewId),
  { lazy: true },
)

const runs = computed<AiReviewRun[]>(() => data.value?.runs ?? [])
const { busy, run: act } = useApiAction({ refresh })
const { confirm } = useConfirm()

/** The states a run can still leave by itself. Anything else has stopped for good. */
const SETTLED = new Set<AiReviewRun['status']>(['completed', 'failed', 'cancelled'])

/**
 * Whether anything here can still change, which is what to poll for.
 *
 * A parked review counts, even though it is waiting on a person: resolving one is
 * ASYNCHRONOUS, so a run polled the instant after Post is still parked, and
 * stopping there would leave the receipt for the pass to a manual refresh.
 */
const inFlight = computed(() => runs.value.some((entry) => !SETTLED.has(entry.status)))

/**
 * Whether a MACHINE is working on any of this, which is what earns the fast
 * cadence.
 *
 * A run at `awaiting_selection` is waiting on a person, and nothing but a click
 * on this card moves it, so reading it every five seconds spends two cat-factory
 * calls a tick against the deployment's key to be told what is already on the
 * screen. A review nobody curates stays open for hours. Acting on one turns it
 * back into work (cat-factory reports the review `posting`, which reads as
 * `running`), and the refresh the action does itself is what picks the cadence
 * back up, so a receipt still arrives seconds after a Post.
 */
const working = computed(() =>
  runs.value.some((entry) => !SETTLED.has(entry.status) && entry.status !== 'awaiting_selection'),
)

const WORKING_POLL_MS = 5000
const PARKED_POLL_MS = 30000
let timer: ReturnType<typeof setTimeout> | null = null

function schedule(): void {
  timer = setTimeout(
    () => {
      // Only while something is moving, and never on top of a call already out.
      if (inFlight.value && busy.value === null) void refresh()
      schedule()
    },
    working.value ? WORKING_POLL_MS : PARKED_POLL_MS,
  )
}

onMounted(schedule)

onUnmounted(() => {
  if (timer !== null) clearTimeout(timer)
})

async function dismiss(runId: string, findingId: string): Promise<void> {
  await act(() => api.dismissAiReviewFinding(runId, findingId), 'Could not dismiss it', findingId)
}

/**
 * Act on a curated selection.
 *
 * `finish` is the one that ASKS first. It is the ghost button beside Post, it
 * takes no selection, and what it does is throw away everything cat-factory
 * found: the run settles, nothing reaches the pull request, and the findings are
 * not recoverable — the only way back is to delegate the whole review again and
 * pay for it twice.
 */
async function resolve(
  runId: string,
  action: AiReviewResolution,
  findingIds: string[],
): Promise<void> {
  if (action === 'finish' && !(await confirmDiscard(runId))) return
  await act(
    () => api.resolveAiReview(runId, action, findingIds),
    action === 'post' ? 'Could not post the comments' : `Could not ${action} the review`,
    action,
  )
}

/**
 * The question, which depends on what there is to lose.
 *
 * A parked run with NOTHING on it is a real state — cat-factory can come back
 * having found nothing, or the last finding can be dismissed one at a time —
 * and the button stays live there, so the dialog asked "Discard all 0
 * findings?" under a warning that they are unrecoverable. Nothing is lost in
 * that case, and saying so is what makes the warning believable in the case
 * where something is.
 */
function confirmDiscard(runId: string): Promise<boolean> {
  const found = runs.value.find((entry) => entry.id === runId)?.curation?.findings.length ?? 0
  if (found === 0) {
    return confirm({
      title: 'Close this review?',
      description:
        'There is nothing left to post, so nothing is lost. The run settles and the pull ' +
        'request hears nothing from cat-factory.',
      confirmLabel: 'Finish without posting',
    })
  }
  return confirm({
    title: found === 1 ? 'Discard this finding?' : `Discard all ${found} findings?`,
    description:
      'The review is closed with nothing posted on the pull request, and what cat-factory found ' +
      'is not kept. Delegating the review again is the only way to see it back.',
    confirmLabel: 'Finish without posting',
  })
}

async function resume(runId: string): Promise<void> {
  await act(() => api.resumeAiReview(runId), 'Could not resume the review', 'resume')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-muted">
        AI reviews of this pull request. cat-factory finds, you choose, then the comments go up.
      </p>
      <UButton
        icon="i-lucide-refresh-cw"
        size="xs"
        variant="ghost"
        :loading="pending"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </div>

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the AI reviews" />

    <!--
      PENDING before empty. The read is lazy, so `runs` is empty while it is
      still in the air, and checking the length first told everybody who opened a
      row that nothing had been delegated — for as long as the cat-factory read
      took, which on a slow one is long enough to be believed and acted on.
    -->
    <LoadingCard v-else-if="pending && data === null" :rows="1" />

    <p v-else-if="runs.length === 0" class="text-sm text-muted">
      Nothing delegated yet. Press <span class="font-medium">AI review</span> to hand this pull
      request to cat-factory.
    </p>

    <AiReviewRunCard
      v-for="entry in runs"
      :key="entry.id"
      :run="entry"
      :busy="busy"
      @dismiss="(findingId) => dismiss(entry.id, findingId)"
      @resolve="(action, findingIds) => resolve(entry.id, action, findingIds)"
      @resume="resume(entry.id)"
    />
  </div>
</template>
