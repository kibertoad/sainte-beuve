<script setup lang="ts">
import type { AiReviewRun } from '@sainte-beuve/contracts'

// What a settled or re-parked AI review actually did to the pull request: the
// comments that landed and the ones that bounced, and the fixer's own account
// of what it committed.
const props = defineProps<{ run: AiReviewRun }>()

const report = computed(() => props.run.curation?.postReport ?? null)

/** What the last posting pass actually landed, in one line. */
const reportLine = computed(() => {
  const it = report.value
  if (it === null) return null
  const attempt = it.attempt === null ? 'The last pass' : `Attempt ${it.attempt}`
  const folded = it.folded === 0 ? '' : `, ${it.folded} folded into the summary comment`
  return `${attempt} posted ${it.posted} of ${it.attempted} comments${folded}.`
})

/**
 * Whether the last pass left anything off the pull request.
 *
 * A false `bodyPosted` counts. A finding whose line is outside the diff is folded
 * into the summary comment rather than failing, so a pass can fold every one of
 * them and then lose the comment that carried them: nothing reached the pull
 * request and `failures` is empty. A null `bodyPosted` is not a failure, because
 * no summary was attempted.
 */
const postFailed = computed(() => {
  const it = report.value
  if (it === null) return false
  return it.failures.length > 0 || it.bodyError !== null || it.bodyPosted === false
})

/** The fixer's account, which is the run's verdict text once a fix has settled it. */
const fixed = computed(() => {
  const curation = props.run.curation
  if (props.run.status !== 'completed' || curation === null) return false
  return curation.status === 'fixing'
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <UAlert
      v-if="report && postFailed"
      color="error"
      variant="subtle"
      icon="i-lucide-message-square-x"
      title="Some comments did not land"
    >
      <template #description>
        <p>{{ reportLine }}</p>
        <p v-if="report.bodyError" class="mt-1">Summary comment: {{ report.bodyError }}</p>
        <p v-else-if="report.bodyPosted === false" class="mt-1">
          The summary comment did not land, so anything folded into it is not on the pull request.
        </p>
        <ul v-if="report.failures.length > 0" class="mt-2 list-disc pl-4">
          <li v-for="failure in report.failures" :key="failure.findingId">
            <span class="font-mono text-xs break-all">{{ codeLocation(failure) }}</span
            >: {{ failure.reason }}
          </li>
        </ul>
        <p class="mt-2 text-xs">
          Applying again skips what already landed, so the same comments cannot go up twice.
        </p>
      </template>
    </UAlert>

    <UAlert
      v-else-if="reportLine"
      color="success"
      variant="subtle"
      icon="i-lucide-message-square-check"
      title="Comments posted"
      :description="reportLine"
    />

    <UAlert
      v-if="run.summary"
      :color="fixed ? 'success' : 'neutral'"
      variant="subtle"
      :icon="fixed ? 'i-lucide-git-commit-horizontal' : 'i-lucide-flag'"
      :title="fixed ? 'What the fixer did' : 'How the review ended'"
    >
      <template #description>
        <p class="whitespace-pre-wrap">{{ run.summary }}</p>
      </template>
    </UAlert>

    <UAlert
      v-if="run.failureReason"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="run.status === 'failed' ? 'The review failed' : 'cat-factory could not be read'"
      :description="run.failureReason"
    />
  </div>
</template>
