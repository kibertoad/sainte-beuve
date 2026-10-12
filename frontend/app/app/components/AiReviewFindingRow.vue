<script setup lang="ts">
import type {
  AiReviewChallengeStatus,
  AiReviewFinding,
  AiReviewSeverity,
} from '@sainte-beuve/contracts'

// One finding of a parked AI review: whether it is ticked, what it says, and the
// two things a curator can do to it alone. Challenge sends it to cat-factory's
// investigator, which upholds, amends or retracts it; Dismiss drops it.
const props = defineProps<{
  finding: AiReviewFinding
  selected: boolean
  /** Whether the review is waiting on its curator, which every control here needs. */
  awaiting: boolean
  posted: boolean
  /** Which action is mid-flight on the run, so one button spins and the rest lock. */
  busy: string | null
}>()

const emit = defineEmits<{
  toggle: []
  dismiss: []
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
 * no verdict. The server holds the same rule and the review-wide budget.
 */
const challengeable = computed(() => {
  const status = challengeState.value?.status
  return props.awaiting && (status === undefined || status === 'failed')
})

const asking = ref(false)
const question = ref('')

function send(): void {
  const concern = question.value.trim()
  emit('challenge', concern === '' ? null : concern)
  asking.value = false
  question.value = ''
}

const location = computed(() =>
  props.finding.line === null ? props.finding.path : `${props.finding.path}:${props.finding.line}`,
)
</script>

<template>
  <div class="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
    <UCheckbox
      :model-value="selected && !retracted"
      :disabled="!awaiting || retracted"
      class="mt-1"
      @update:model-value="emit('toggle')"
    />
    <div class="min-w-0 grow">
      <div class="flex items-center gap-2 flex-wrap">
        <UBadge :color="severityColor[finding.severity]" size="sm" variant="subtle">
          {{ finding.severity }}
        </UBadge>
        <UBadge size="sm" variant="subtle" color="neutral">{{ finding.category }}</UBadge>
        <span class="font-medium" :class="{ 'line-through text-muted': retracted }">
          {{ finding.title }}
        </span>
        <UBadge v-if="posted" size="sm" variant="subtle" color="success">posted</UBadge>
        <UBadge
          v-if="challengeState"
          size="sm"
          variant="subtle"
          :color="verdictColor[challengeState.status]"
        >
          {{ verdictLabel[challengeState.status] }}
        </UBadge>
      </div>
      <p class="font-mono text-xs text-muted mt-1 break-all">{{ location }}</p>
      <p class="text-sm mt-1 whitespace-pre-wrap" :class="{ 'text-muted': retracted }">
        {{ finding.detail }}
      </p>
      <pre
        v-if="finding.suggestedFix && !retracted"
        class="text-xs mt-2 p-2 rounded bg-elevated overflow-x-auto"
        >{{ finding.suggestedFix }}</pre>
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
      <div v-if="asking" class="mt-2 flex flex-col gap-2">
        <UTextarea
          v-model="question"
          :rows="2"
          :maxlength="4000"
          autoresize
          class="w-full"
          placeholder="What do you doubt? Leave empty to ask for the grounding."
        />
        <div class="flex flex-wrap gap-2">
          <UButton size="sm" icon="i-lucide-search-check" @click="send">Challenge</UButton>
          <UButton size="sm" variant="ghost" color="neutral" @click="asking = false">
            Cancel
          </UButton>
        </div>
      </div>
    </div>
    <div class="flex flex-col gap-1 shrink-0 sm:flex-row">
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
        <span class="sr-only sm:not-sr-only">Challenge</span>
      </UButton>
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-lucide-x"
        :disabled="!awaiting"
        :loading="busy === finding.findingId"
        @click="emit('dismiss')"
      >
        <span class="sr-only sm:not-sr-only">Dismiss</span>
      </UButton>
    </div>
  </div>
</template>
