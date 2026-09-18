<script setup lang="ts">
import type { AssignedReviewer, BoardReview, ShortfallReason } from '@sainte-beuve/contracts'
import {
  ACTIVE_REVIEW_STATUSES,
  ALL_REVIEW_STATUSES,
  BOARD_REVIEW_QUERY,
  formatPullRequestRef,
  shortfallCause,
  shortfallRemedy,
} from '@sainte-beuve/contracts'

// The review board: every pull request sainte-beuve is TRACKING, and the two
// actions a viewer can take on each row.
//
// Not the same screen as the workspace, and deliberately so. The workspace is
// what one person has to act on, read live from the hosts; the board is what
// the deployment has taken responsibility for, which is the rows a label or a
// webhook created and the reminder ladder is chasing. Merging them would put a
// team-wide backlog in the way of somebody's own three lists.
const api = useSainteBeuveApi()
const route = useRoute()
const router = useRouter()

/**
 * Which review a link asked for, from `?review=<id>` — see `boardReviewPath` in
 * the contracts, which is what builds it.
 *
 * Every Slack nudge carries one. They used to point at `/reviews/<id>`, a route
 * this SPA has never had, so the message whose whole point is "the findings are
 * on the board, not on the pull request" landed on an error page.
 */
const linked = computed(() => {
  const asked = route.query[BOARD_REVIEW_QUERY]
  return typeof asked === 'string' && asked.length > 0 ? asked : null
})

/**
 * Whether reviews that have STOPPED are on the screen.
 *
 * Off by default, which is the whole difference between a board and a table
 * dump: terminal rows are never archived, so an unfiltered read grew with
 * everything the deployment had ever tracked and put last quarter's approvals
 * between the two things somebody has to do today.
 *
 * On when a link named a review, because the link has to work: a nudge about a
 * review that was approved while the notification sat unread must land on that
 * row rather than on an empty board.
 */
const showSettled = ref(linked.value !== null)

/**
 * Which statuses the read asks for. EVERY status, spelled out, or the active three.
 *
 * Not `undefined` for the first: an absent `status` is not "everything" to this
 * API, it is "the default", and the default is the active three — so omitting
 * the key re-read the same list the switch was off for and "Show settled"
 * showed nothing. Which also broke the deep link, whose whole point is that a
 * nudge about a review approved while the notification sat unread still lands
 * on its row.
 */
const statusFilter = computed(() =>
  showSettled.value ? ALL_REVIEW_STATUSES : ACTIVE_REVIEW_STATUSES,
)

// LAZY, and not awaited: a page that awaits its read at setup holds the previous
// screen on screen until the whole list is down, validated and mounted, so a
// click on this destination looks like nothing happened. Rendered immediately
// instead, the skeleton below says what is coming. `AiReviewPanel` has done this
// since it was written, for the same reason.
//
// `watch` on the filter, so flipping the toggle re-reads rather than cutting a
// list the server already narrowed: the cap is applied before the filter is, so
// a client-side cut of the active page would be a page of history with the
// active rows missing.
const { data, pending, error, refresh } = useAsyncData(
  'reviews',
  () => api.listReviews({ status: statusFilter.value }),
  { lazy: true, watch: [statusFilter] },
)

const reviews = computed<BoardReview[]>(() => data.value?.reviews ?? [])

/**
 * The moment the rows date themselves against.
 *
 * ONE clock for the whole list, read when the page mounts and again on every
 * refresh, rather than a `Date.now()` per row: twenty rows reading their own
 * would each be frozen at a different instant, and none of them would move when
 * the board was re-read.
 */
const now = ref(Date.now())

// Both of these routes refuse for reasons a viewer can act on (503 while
// cat-factory is unconfigured, which is every fresh deployment; 404 for a review
// somebody else has closed), which is what `useApiAction` is for: it toasts the
// API's own message and refreshes the board. One copy, shared with the
// Configuration screen, so a change to how a refusal is shown lands in one file.
/**
 * Re-read the board and re-date it.
 *
 * The clock moves with the rows rather than with the wall: a refresh that left
 * `now` where it was would answer a fresh list with stale ages, which on the one
 * screen whose job is "how long has this sat" is the number somebody reads.
 */
async function reload(): Promise<void> {
  await refresh()
  now.value = Date.now()
}

const { run } = useApiAction({ refresh: reload })
const toast = useToast()

/**
 * Why a successful assign put nobody on the row.
 *
 * The route answers 200 with an empty `assigned` list and the reason, because
 * "everybody who could take this is already on it" is a configuration answer
 * rather than a fault.
 *
 * The sentence comes from `@sainte-beuve/contracts`, which is where the bot's
 * reply on the pull request reads it too, so the two cannot drift.
 */
function shortfallMessage(reason: ShortfallReason): string {
  const remedy = shortfallRemedy(reason)
  const cause = `${shortfallCause(reason)}.`
  return remedy === null ? cause : `${cause} ${remedy}`
}

/** Who it went to, as the Slack reply and the bot's comment already say it. */
function assignedMessage(assigned: AssignedReviewer[]): string {
  return assigned.map((entry) => entry.displayName).join(', ')
}

async function assign(review: BoardReview) {
  await run(async () => {
    const result = await api.assignReviewers(review.id)
    if (result.shortfallReason !== null) {
      toast.add({
        color: 'warning',
        title: 'Nobody was assigned',
        description: shortfallMessage(result.shortfallReason),
      })
      return
    }
    if (result.assigned.length === 0) return
    // NAMED. The board was the one surface that did not say who got it: Slack
    // replies "`owner/repo#7` now goes to Ada." and the bot's comment names them
    // too, while here the badge moved to "Assigned" and nothing else changed.
    toast.add({
      color: 'success',
      title: `${formatPullRequestRef(review.pullRequest)} goes to ${assignedMessage(result.assigned)}`,
    })
  }, 'Could not find a reviewer')
}

/**
 * Which rows have their AI-review panel open.
 *
 * Open rather than always-on, because each open panel polls cat-factory while
 * anything on it is moving, and a board of twenty rows all polling is twenty
 * reviews a nobody is looking at. Delegating a review opens its own panel, since
 * the findings are what the person who pressed the button is waiting for — and
 * so does arriving on a link that named one, which is the whole reason a nudge
 * carries the id.
 */
const expanded = ref(new Set<string>(linked.value === null ? [] : [linked.value]))

function toggle(reviewId: string) {
  const next = new Set(expanded.value)
  if (!next.delete(reviewId)) next.add(reviewId)
  expanded.value = next
}

async function requestAiReview(review: BoardReview) {
  const filed = await run(() => api.requestAiReview(review.id), 'Could not request an AI review')
  if (filed) expanded.value = new Set(expanded.value).add(review.id)
}

/** Whether the linked review turned out not to be on the board at all. */
const linkedMissing = computed(
  () =>
    linked.value !== null &&
    data.value !== null &&
    !reviews.value.some((review) => review.id === linked.value),
)

/**
 * Bring the linked row into view once the list it is in has rendered.
 *
 * `scrollIntoView` on the element rather than a router hash, because the row is
 * a card in a list rather than a navigation target, and the list does not exist
 * until the read lands. It runs once — a later refresh must not yank the page
 * back to a row somebody has scrolled away from — but only once it has actually
 * SCROLLED: the first list to arrive need not carry the linked review (the
 * settled read is a second round trip, and a refresh can be what brings it),
 * and a latch spent on a list without the row meant the read that finally had
 * it scrolled nowhere.
 */
let scrolled = false
watch(
  reviews,
  async () => {
    if (linked.value === null || scrolled) return
    if (!reviews.value.some((review) => review.id === linked.value)) return
    await nextTick()
    const row = document.getElementById(`review-${linked.value}`)
    if (row === null) return
    scrolled = true
    row.scrollIntoView({ block: 'center' })
  },
  // IMMEDIATE, because a second visit to this route renders from the payload
  // Nuxt already holds: the list is on screen at setup and never changes
  // reference, so a watch that only fired on a change would never fire at all.
  { immediate: true },
)

/** Drop the `?review=` once it has been honoured, so a refresh is not a re-scroll. */
function clearLink() {
  void router.replace({ query: {} })
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <!--
          "Board", which is what the rail, the README and the Slack copy call it.
          The heading said "Reviews", so the destination somebody clicked and the
          screen they arrived on had different names.
        -->
        <h1 class="text-2xl font-semibold">Board</h1>
        <p class="text-sm text-muted">
          The reviews this deployment is chasing, the ones waiting longest first.
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="ghost"
        class="shrink-0"
        :loading="pending"
        @click="reload()"
      >
        Refresh
      </UButton>
    </div>

    <div class="flex flex-wrap items-center gap-3 mb-4">
      <USwitch
        v-model="showSettled"
        label="Show settled"
        description="Approved, closed and changes-requested reviews, below the ones still waiting."
      />
    </div>

    <!--
      ABOVE the branch below, not inside its list: a link can name a review on a
      board that is otherwise empty, and "nothing is being reviewed" is the wrong
      answer to "take me to this review".
    -->
    <UAlert
      v-if="linkedMissing"
      class="mb-3"
      color="warning"
      variant="subtle"
      title="That review is not on this board"
      description="It may have been closed and dropped, or it belongs to another org. Everything this deployment is still tracking is below."
      :close="true"
      @update:open="clearLink()"
    />

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the review board" />

    <LoadingCard v-else-if="pending && data === null" />

    <UCard v-else-if="reviews.length === 0">
      <p class="text-sm text-muted">
        Nothing is being reviewed. A pull request arrives here when its repository reports one
        carrying the review label — <code>needs-review</code>, unless this deployment renamed it —
        so the next step is the webhook on the
        <ULink to="/configuration">Configuration</ULink> screen.
      </p>
    </UCard>

    <div v-else class="flex flex-col gap-3">
      <BoardReviewCard
        v-for="review in reviews"
        :id="`review-${review.id}`"
        :key="review.id"
        :review="review"
        :expanded="expanded.has(review.id)"
        :now="now"
        @assign="assign(review)"
        @ai-review="requestAiReview(review)"
        @toggle="toggle(review.id)"
      />
    </div>
  </UContainer>
</template>
