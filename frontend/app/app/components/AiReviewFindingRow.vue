<script setup lang="ts">
import type {
  AiReviewChallengeStatus,
  AiReviewFinding,
  AiReviewSeverity,
  PullRequestRef,
} from '@sainte-beuve/contracts'
import { pickChoice, type ReviewOutcome } from '../utils/aiReviewPlan'

// One finding of an AI review: what it says, whether the review's outcome acts
// on it, and the challenge that sends it back to cat-factory's investigator, which
// upholds, amends or retracts it.
const props = defineProps<{
  finding: AiReviewFinding
  /** The pull request under review, for the link into its diff. */
  pullRequest: PullRequestRef | null
  /** Whether the review's outcome acts on this finding. */
  picked: boolean
  outcome: ReviewOutcome
  /** Whether the review is waiting on its curator, which every control here needs. */
  awaiting: boolean
  posted: boolean
  /** Whether the review has challenged as many findings as it may. */
  challengesSpent: boolean
  /** Which action is mid-flight on the run, so one button spins and the rest lock. */
  busy: string | null
}>()

const emit = defineEmits<{
  pick: [picked: boolean]
  challenge: [question: string | null]
}>()

type BadgeColor = 'error' | 'warning' | 'info' | 'success' | 'neutral'

const severityColor: Record<AiReviewSeverity, BadgeColor> = {
  blocker: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
  nit: 'neutral',
}

const verdictColor: Record<AiReviewChallengeStatus, BadgeColor> = {
  investigating: 'info',
  upheld: 'success',
  amended: 'warning',
  retracted: 'neutral',
  failed: 'error',
}

const verdictLabel: Record<AiReviewChallengeStatus, string> = {
  investigating: 'being investigated',
  upheld: 'upheld',
  amended: 'amended',
  retracted: 'retracted',
  failed: 'investigation failed',
}

const challengeState = computed(() => props.finding.challenge)
const retracted = computed(() => challengeState.value?.status === 'retracted')

/**
 * Whether this finding may be sent to the investigator. A verdict is final, so a
 * finding that has one is not offered again, except after a failure, which bought
 * no verdict and is already counted against the review's budget. The server
 * holds the same rules.
 */
const challengeable = computed(() => {
  const status = challengeState.value?.status
  if (!props.awaiting) return false
  return status === 'failed' || (status === undefined && !props.challengesSpent)
})

const asking = ref(false)
const question = ref('')

function send(): void {
  emit('challenge', blankToNull(question.value))
  asking.value = false
  question.value = ''
}

const location = computed(() => codeLocation(props.finding))

const bodyId = useId()
const lead = computed(() => leadOf(props.finding.detail))
const fix = computed(() => (retracted.value ? null : props.finding.suggestedFix))
const collapsible = computed(() => lead.value.truncated || fix.value !== null)
const expanded = ref(false)
const toggleLabel = computed(() => {
  if (expanded.value) return 'Show less'
  return lead.value.truncated ? 'Show more' : 'Show the suggested fix'
})

const diffHref = ref<string | null>(null)
watch(
  () => [props.pullRequest, props.finding] as const,
  async ([pullRequest, finding]) => {
    const href = pullRequest === null ? null : await filesChangedHref(pullRequest, finding)
    if (pullRequest === props.pullRequest && finding === props.finding) diffHref.value = href
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
    <div class="min-w-0 grow">
      <div class="flex items-center gap-2 flex-wrap">
        <UBadge :color="severityColor[finding.severity]" size="sm" variant="subtle">
          {{ finding.severity }}
        </UBadge>
        <UBadge size="sm" variant="subtle" color="neutral">{{ finding.category }}</UBadge>
        <span class="font-medium" :class="{ 'line-through text-muted': retracted }">
          {{ finding.title }}
        </span>
        <UBadge v-if="posted" size="sm" variant="subtle" color="success">commented</UBadge>
        <UBadge
          v-if="challengeState"
          size="sm"
          variant="subtle"
          :color="verdictColor[challengeState.status]"
        >
          {{ verdictLabel[challengeState.status] }}
        </UBadge>
      </div>
      <div class="flex items-center gap-1 mt-1">
        <p class="font-mono text-xs text-muted break-all">{{ location }}</p>
        <UButton
          v-if="diffHref"
          :to="diffHref"
          target="_blank"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-external-link"
          aria-label="Open in the pull request's changed files"
          title="Files changed"
        />
      </div>
      <div :id="bodyId" class="text-sm mt-1" :class="{ 'text-muted': retracted }">
        <MarkdownText v-if="expanded" :source="finding.detail" />
        <MarkdownText v-else :source="lead.lead" class="line-clamp-2" />
        <div v-if="expanded && fix" class="mt-2">
          <p class="text-xs font-medium text-muted mb-1">Suggested fix</p>
          <MarkdownText v-if="hasCodeFence(fix)" :source="fix" />
          <pre
            v-else
            class="text-xs font-mono p-2 rounded bg-elevated whitespace-pre-wrap break-words"
            >{{ fix }}</pre>
        </div>
      </div>
      <UButton
        v-if="collapsible"
        size="xs"
        variant="link"
        color="neutral"
        class="px-0"
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        :trailing-icon="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="expanded = !expanded"
      >
        {{ toggleLabel }}
      </UButton>
      <div v-if="challengeState" class="mt-2 text-sm border-l-2 border-default pl-3">
        <p v-if="challengeState.question" class="text-muted">
          Asked: {{ challengeState.question }}
        </p>
        <p v-if="challengeState.justification" class="whitespace-pre-wrap">
          {{ challengeState.justification }}
        </p>
        <p v-else-if="challengeState.status === 'investigating'" class="text-muted">
          cat-factory is re-reading the source behind this finding. The verdict appears here.
        </p>
      </div>
      <div v-if="asking && challengeable" class="mt-2 flex flex-col gap-2">
        <UTextarea
          v-model="question"
          :rows="2"
          :maxlength="4000"
          autoresize
          class="w-full"
          placeholder="What do you doubt? Leave empty to ask for the grounding."
        />
        <div class="flex flex-wrap gap-2">
          <UButton size="sm" icon="i-lucide-search-check" :disabled="busy !== null" @click="send">
            Challenge
          </UButton>
          <UButton size="sm" variant="ghost" color="neutral" @click="asking = false">
            Cancel
          </UButton>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-col sm:items-end">
      <UCheckbox
        v-if="awaiting && !retracted"
        :model-value="picked"
        :label="pickChoice[outcome].on"
        :description="picked ? undefined : pickChoice[outcome].off"
        :disabled="busy === 'resolve'"
        @update:model-value="(value) => emit('pick', value === true)"
      />
      <UButton
        v-if="challengeable && !asking"
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-lucide-search-check"
        :loading="busy === `challenge:${finding.findingId}`"
        :disabled="busy !== null"
        @click="asking = true"
      >
        Challenge
      </UButton>
    </div>
  </div>
</template>
