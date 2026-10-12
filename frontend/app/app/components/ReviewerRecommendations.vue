<script setup lang="ts">
import type { ReviewerRecommendation, ReviewerRecommendations } from '@sainte-beuve/contracts'
import { shortfallCause, shortfallRemedy } from '@sainte-beuve/contracts'

// Who fits this pull request best, and why. While a new ranking loads the
// previous one stays, dimmed, so the dialog does not jump on every click.
const props = defineProps<{
  result: ReviewerRecommendations | null
  pending: boolean
  failure: string | null
  sameTeamOnly: boolean
}>()

const wantedCount = computed(() => {
  const wanted = props.result?.wanted
  return wanted === undefined ? 0 : wanted.skills.length + wanted.domains.length
})

const emptyMessage = computed(() => {
  const reason = props.result?.shortfallReason
  if (reason === null || reason === undefined) return 'Nobody to recommend.'
  if (reason === 'all_excluded' && props.sameTeamOnly) {
    return 'Nobody else on your team can be asked about this.'
  }
  const remedy = shortfallRemedy(reason)
  return remedy === null ? `${shortfallCause(reason)}.` : `${shortfallCause(reason)}. ${remedy}`
})

function matchLine(entry: ReviewerRecommendation): string {
  const matched = entry.reasons.matchedSkills.length + entry.reasons.matchedDomains.length
  if (wantedCount.value === 0) return 'Nothing in particular is wanted'
  return `Matches ${matched} of ${wantedCount.value}`
}

function loadLine(entry: ReviewerRecommendation): string {
  const open = entry.reasons.outstandingReviews
  if (open === 0) return 'No open reviews'
  return open === 1 ? '1 open review' : `${open} open reviews`
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="failure" class="text-sm text-error">{{ failure }}</p>
    <LoadingSpinner v-else-if="result === null" label="Ranking reviewers…" />
    <div v-else :class="{ 'opacity-60': pending }">
      <p v-if="result.recommendations.length === 0" class="text-sm text-muted">
        {{ emptyMessage }}
      </p>
      <ol v-else class="flex flex-col gap-2">
        <li
          v-for="entry in result.recommendations"
          :key="entry.reviewerId"
          class="flex flex-col gap-1 rounded-md border border-default p-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
        >
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-sm font-medium">
              {{ entry.displayName }}
              <span v-if="entry.team" class="font-normal text-muted">· {{ entry.team }}</span>
            </span>
            <div
              v-if="entry.reasons.matchedSkills.length + entry.reasons.matchedDomains.length > 0"
              class="flex flex-wrap gap-1"
            >
              <UBadge
                v-for="skill in entry.reasons.matchedSkills"
                :key="`skill-${skill}`"
                variant="subtle"
                size="sm"
                >{{ skill }}</UBadge
              >
              <UBadge
                v-for="domain in entry.reasons.matchedDomains"
                :key="`domain-${domain}`"
                color="neutral"
                variant="subtle"
                size="sm"
                >{{ domain }}</UBadge
              >
            </div>
          </div>
          <div class="flex flex-col text-xs text-muted sm:shrink-0 sm:text-right">
            <span>{{ matchLine(entry) }}</span>
            <span>{{ loadLine(entry) }}</span>
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>
