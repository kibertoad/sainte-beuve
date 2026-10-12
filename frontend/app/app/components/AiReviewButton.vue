<script setup lang="ts">
import type { PullRequestRef } from '@sainte-beuve/contracts'
import { boardReviewPath } from '@sainte-beuve/contracts'

// "AI review" on a row that may not be on the board yet. Filing tracks the pull
// request there when it is not, and the findings are curated on its board row,
// so the button goes there once cat-factory has the run.
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
const { busy, run } = useApiAction()

async function file() {
  let reviewId: string | null = null
  const filed = await run(
    async () => {
      const filedRun = await api.requestPullRequestAiReview({
        pullRequest: props.pullRequest,
        title: props.title,
        authorLogin: props.authorLogin ?? null,
      })
      reviewId = filedRun.reviewId
    },
    'Could not request an AI review',
    props.pullRequest.url,
  )
  if (filed && reviewId !== null) await navigateTo(boardReviewPath(reviewId))
}
</script>

<template>
  <UButton
    v-if="capabilities.confirmed('aiReview')"
    size="sm"
    variant="ghost"
    icon="i-lucide-bot"
    :loading="busy !== null"
    @click="file"
  >
    AI review
  </UButton>
</template>
