<script setup lang="ts">
import type { PullRequestRef } from '@sainte-beuve/contracts'
import { aiReviewPath } from '@sainte-beuve/contracts'

// "AI review" on a row that may not be on the board yet. Filing tracks the pull
// request there when it is not, because a run belongs to a board row, and the
// button then opens the review screen, where the run is followed and settled.
//
// Shown only once the org is known to have the capability: unlike a warning,
// a button that appears and then refuses is a click wasted on every row.
const props = defineProps<{
  pullRequest: PullRequestRef
  title: string
  /** Null where the row does not know it, as a commitment does not. */
  authorLogin?: string | null
}>()

const api = useSainteBeuveApi()
const capabilities = useCapabilities()
const { showError } = useErrorToast()
const busy = ref(false)

async function file() {
  busy.value = true
  const reviewId = await fileOrExplain()
  busy.value = false
  if (reviewId !== null) await navigateTo(aiReviewPath(reviewId))
}

/**
 * The review to open: the one the run was filed on, or, when the refusal names
 * one (a run already in flight, the hourly limit), the one it is about.
 */
async function fileOrExplain(): Promise<string | null> {
  try {
    const run = await api.requestPullRequestAiReview({
      pullRequest: props.pullRequest,
      title: props.title,
      authorLogin: props.authorLogin ?? null,
    })
    return run.reviewId
  } catch (err) {
    showError('Could not request an AI review', err, apiErrorMessage(err), () => void file())
    return refusedReviewId(err)
  }
}

function refusedReviewId(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null
  const details = err.details as { reviewId?: unknown } | undefined
  return typeof details?.reviewId === 'string' ? details.reviewId : null
}
</script>

<template>
  <UButton
    v-if="capabilities.confirmed('aiReview')"
    size="sm"
    variant="ghost"
    icon="i-lucide-bot"
    :loading="busy"
    @click="file"
  >
    AI review
  </UButton>
</template>
