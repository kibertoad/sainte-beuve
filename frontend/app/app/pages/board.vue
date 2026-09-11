<script setup lang="ts">
import type { ReviewRequest, ShortfallReason } from '@sainte-beuve/contracts'
import { shortfallCause, shortfallRemedy } from '@sainte-beuve/contracts'

// The review board: every pull request sainte-beuve is TRACKING, and the two
// actions a viewer can take on each row.
//
// Not the same screen as the workspace, and deliberately so. The workspace is
// what one person has to act on, read live from the hosts; the board is what
// the deployment has taken responsibility for, which is the rows a label or a
// webhook created and the reminder ladder is chasing. Merging them would put a
// team-wide backlog in the way of somebody's own three lists.
const api = useSainteBeuveApi()
const { data, pending, error, refresh } = await useAsyncData('reviews', () => api.listReviews())

const reviews = computed<ReviewRequest[]>(() => data.value?.reviews ?? [])

type BadgeColor = 'error' | 'info' | 'success' | 'warning' | 'neutral'

const statusColor: Record<ReviewRequest['status'], BadgeColor> = {
  open: 'warning',
  assigned: 'info',
  in_review: 'info',
  approved: 'success',
  changes_requested: 'error',
  closed: 'neutral',
}

// Both of these routes refuse for reasons a viewer can act on (503 while
// cat-factory is unconfigured, which is every fresh deployment; 404 for a review
// somebody else has closed), which is what `useApiAction` is for: it toasts the
// API's own message and refreshes the board. One copy, shared with the
// Configuration screen, so a change to how a refusal is shown lands in one file.
const { run } = useApiAction({ refresh })
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

async function assign(review: ReviewRequest) {
  await run(async () => {
    const result = await api.assignReviewers(review.id)
    if (result.shortfallReason !== null) {
      toast.add({
        color: 'warning',
        title: 'Nobody was assigned',
        description: shortfallMessage(result.shortfallReason),
      })
    }
  }, 'Could not find a reviewer')
}

/**
 * Which rows have their AI-review panel open.
 *
 * Open rather than always-on, because each open panel polls cat-factory while
 * anything on it is moving, and a board of twenty rows all polling is twenty
 * reviews a nobody is looking at. Delegating a review opens its own panel, since
 * the findings are what the person who pressed the button is waiting for.
 */
const expanded = ref(new Set<string>())

function toggle(reviewId: string) {
  const next = new Set(expanded.value)
  if (!next.delete(reviewId)) next.add(reviewId)
  expanded.value = next
}

async function requestAiReview(review: ReviewRequest) {
  const filed = await run(() => api.requestAiReview(review.id), 'Could not request an AI review')
  if (filed) expanded.value = new Set(expanded.value).add(review.id)
}
</script>

<template>
  <UContainer class="py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Reviews</h1>
        <p class="text-sm text-muted">Everything waiting on a human, and what it is waiting for.</p>
      </div>
      <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="pending" @click="refresh()">
        Refresh
      </UButton>
    </div>

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the review board" />

    <UCard v-else-if="reviews.length === 0">
      <p class="text-sm text-muted">
        Nothing is being reviewed. Open a pull request, or register one through the API.
      </p>
    </UCard>

    <div v-else class="flex flex-col gap-3">
      <UCard v-for="review in reviews" :key="review.id">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <ULink :to="review.pullRequest.url" target="_blank" class="font-medium">
              {{ review.pullRequest.owner }}/{{ review.pullRequest.repo }}#{{
                review.pullRequest.number
              }}
            </ULink>
            <p class="text-sm text-muted truncate">{{ review.title }}</p>
            <div class="flex gap-1 mt-2">
              <UBadge
                v-for="skill in review.requiredSkills"
                :key="skill"
                variant="subtle"
                size="sm"
              >
                {{ skill }}
              </UBadge>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <UBadge :color="statusColor[review.status]" variant="subtle">
              {{ review.status }}
            </UBadge>
            <UButton size="sm" variant="soft" @click="assign(review)">Find a reviewer</UButton>
            <UButton size="sm" variant="ghost" @click="requestAiReview(review)">AI review</UButton>
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              :icon="expanded.has(review.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-label="expanded.has(review.id) ? 'Hide the AI reviews' : 'Show the AI reviews'"
              @click="toggle(review.id)"
            />
          </div>
        </div>
        <div v-if="expanded.has(review.id)" class="mt-4 pt-4 border-t border-default">
          <AiReviewPanel :review-id="review.id" />
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
