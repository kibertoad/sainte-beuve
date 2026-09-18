<script setup lang="ts">
import type { BoardReview } from '@sainte-beuve/contracts'
import { formatPullRequestRef, reviewStatusLabel } from '@sainte-beuve/contracts'

// One row of the board: what the review is, who is on the hook for it, and how
// long it has been waiting.
//
// Extracted from the page because the row grew a job. It used to be a title, a
// status and three buttons, which answered none of the questions the board is
// for: the reader could not tell who had it, how long it had sat, or whether it
// was past its deadline. Everything below is one of those three, and the page is
// back to being the list and the filter.
const props = defineProps<{
  review: BoardReview
  /** Whether the AI-review panel under this row is open. */
  expanded: boolean
  /**
   * The moment the page rendered, passed DOWN rather than read here.
   *
   * Every row on a board compares against one clock, so an age computed per row
   * would have twenty slightly different "now"s in it, and each would be frozen
   * at a different mount. The page owns the tick; this renders what it says.
   */
  now: number
}>()

const emit = defineEmits<{ assign: []; aiReview: []; toggle: [] }>()

type BadgeColor = 'error' | 'info' | 'success' | 'warning' | 'neutral'

const statusColor: Record<BoardReview['status'], BadgeColor> = {
  open: 'warning',
  assigned: 'info',
  in_review: 'info',
  approved: 'success',
  changes_requested: 'error',
  closed: 'neutral',
}

/** Null on everything but `high`: a mark on every row is a mark nobody reads. */
const priority = computed(() => (props.review.priority === 'high' ? 'high priority' : null))

const due = computed(() => dueState(props.review, props.now))

/**
 * Who has it, as a sentence.
 *
 * Three cases, and they are three different things to do about the row.
 * Unassigned is the state the whole reminder ladder exists to shorten, so it
 * says so rather than showing nothing; assigned to people this deployment can no
 * longer name is rare and worth being honest about, because the review is on
 * somebody's hook and the row cannot say whose.
 */
const assignedTo = computed(() => {
  const { assignedReviewers, assignedReviewerIds } = props.review
  if (assignedReviewers.length > 0)
    return assignedReviewers.map((entry) => entry.displayName).join(', ')
  return assignedReviewerIds.length > 0 ? 'somebody no longer in the directory' : null
})
</script>

<template>
  <UCard>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ULink :to="review.pullRequest.url" target="_blank" class="font-medium">
            {{ formatPullRequestRef(review.pullRequest) }}
          </ULink>
          <UBadge v-if="priority" color="error" variant="subtle" size="sm">{{ priority }}</UBadge>
          <UBadge
            v-if="due"
            :color="due === 'overdue' ? 'error' : 'warning'"
            variant="subtle"
            size="sm"
            icon="i-lucide-alarm-clock"
          >
            {{ dueLabel(due, review, now) }}
          </UBadge>
        </div>
        <p class="text-sm text-muted line-clamp-2">{{ review.title }}</p>
        <!--
          The three facts the row exists to carry. `waiting N` rather than a
          timestamp, because the question is whether this has been ignored and a
          date makes somebody work that out for themselves.
        -->
        <p class="text-xs text-muted mt-1">
          <template v-if="assignedTo">with {{ assignedTo }}</template>
          <template v-else>nobody has it yet</template>
          &middot; opened by {{ review.authorLogin }} &middot; waiting
          {{ relativeAge(review.createdAt, now) }}
        </p>
        <div v-if="review.requiredSkills.length > 0" class="flex flex-wrap gap-1 mt-2">
          <UBadge v-for="skill in review.requiredSkills" :key="skill" variant="subtle" size="sm">
            {{ skill }}
          </UBadge>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 sm:shrink-0">
        <!--
          The LABEL, not the stored value. `in_review` was rendered as itself,
          which a screen reader reads letter by letter and which nobody outside
          this codebase has a name for. One table, in the contracts, shared with
          the Slack replies.
        -->
        <UBadge :color="statusColor[review.status]" variant="subtle">
          {{ reviewStatusLabel(review.status) }}
        </UBadge>
        <UButton size="sm" variant="soft" @click="emit('assign')">Find a reviewer</UButton>
        <UButton size="sm" variant="ghost" @click="emit('aiReview')">AI review</UButton>
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          :icon="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          :aria-label="expanded ? 'Hide the AI reviews' : 'Show the AI reviews'"
          @click="emit('toggle')"
        />
      </div>
    </div>
    <div v-if="expanded" class="mt-4 pt-4 border-t border-default">
      <AiReviewPanel :review-id="review.id" />
    </div>
  </UCard>
</template>
