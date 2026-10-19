<script setup lang="ts">
import type { AiReviewRun, ResolveAiReviewInput } from '@sainte-beuve/contracts'
import { applyLabel, planOf, planTally, type ReviewOutcome } from '../utils/aiReviewPlan'
import { aiReviewStatusColor, aiReviewStatusLabel } from '../utils/aiReviewStatus'

// One delegated review, followed from filing to the last comment or commit.
//
// The screen exists for the parked state: cat-factory hands back what it found
// and does nothing until somebody settles it, either with comments for the
// author or with fixes cat-factory commits, on the findings they pick.
// Everything else here is context for that decision.
const props = defineProps<{
  run: AiReviewRun
  /** Which action is mid-flight on this run, so one button spins and the rest lock. */
  busy: string | null
}>()

const emit = defineEmits<{
  challenge: [findingId: string, question: string | null]
  resolve: [resolution: ResolveAiReviewInput, done: () => void]
  resume: []
}>()

const curation = computed(() => props.run.curation)
const awaiting = computed(() => props.run.status === 'awaiting_selection')
const { draft, settleBy, pick, pickWhere, reset, drafted } = useReviewDraft(() => props.run)
const plan = computed(() => (curation.value === null ? null : planOf(curation.value, draft.value)))

const outcomes: { value: ReviewOutcome; label: string; icon: string; hint: string }[] = [
  {
    value: 'comment',
    label: 'Comment for the author',
    icon: 'i-lucide-message-square',
    hint: 'The picked findings go on the pull request as review comments, for its author to address.',
  },
  {
    value: 'fix',
    label: 'Fix with cat-factory',
    icon: 'i-lucide-wrench',
    hint: "cat-factory's fixer commits fixes for the picked findings onto the branch. Nothing is posted.",
  },
]
const outcomeHint = computed(() => outcomes.find((o) => o.value === draft.value.outcome)?.hint)

function pickSeverities(severities: string[]): void {
  pickWhere((finding) => severities.includes(finding.severity))
}

function apply(): void {
  if (plan.value) emit('resolve', plan.value.resolution, reset)
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge :color="aiReviewStatusColor[run.status]" variant="subtle">
            {{ aiReviewStatusLabel[run.status] }}
          </UBadge>
          <span class="text-xs text-muted">
            filed {{ new Date(run.requestedAt).toLocaleString() }}
          </span>
        </div>
        <UButton
          v-if="safeHref(run.catFactoryUrl)"
          :to="safeHref(run.catFactoryUrl)"
          target="_blank"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-external-link"
          class="self-start"
        >
          Run log in cat-factory
        </UButton>
      </div>
    </template>

    <div class="flex flex-col gap-5">
      <AiReviewJourney :run="run" :busy="busy" @resume="emit('resume')" />

      <div v-if="curation?.summary" class="text-sm border-l-2 border-primary pl-3">
        <p class="text-xs font-medium text-muted mb-1">The reviewer's take</p>
        <p class="whitespace-pre-wrap">{{ curation.summary }}</p>
      </div>

      <AiReviewReceipt :run="run" />

      <p v-if="!curation || curation.findings.length === 0" class="text-sm text-muted">
        {{
          run.status === 'completed'
            ? 'The review finished with nothing left to decide.'
            : 'No findings yet. They arrive together once every slice of the diff is in.'
        }}
      </p>

      <template v-else>
        <div v-if="awaiting" class="flex flex-col gap-2">
          <p class="text-sm">
            Settle the review one way: comment so the author fixes what you pick, or have
            cat-factory fix it.
          </p>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap gap-2" role="group" aria-label="How the review settles">
              <UButton
                v-for="option in outcomes"
                :key="option.value"
                size="sm"
                :icon="option.icon"
                :color="draft.outcome === option.value ? 'primary' : 'neutral'"
                :variant="draft.outcome === option.value ? 'solid' : 'outline'"
                :aria-pressed="draft.outcome === option.value"
                :disabled="busy === 'resolve'"
                @click="settleBy(option.value)"
              >
                {{ option.label }}
              </UButton>
            </div>
            <UDropdownMenu
              :items="[
                [
                  {
                    label: 'Blockers and highs',
                    onSelect: () => pickSeverities(['blocker', 'high']),
                  },
                  {
                    label: 'Mediums and up',
                    onSelect: () => pickSeverities(['blocker', 'high', 'medium']),
                  },
                  { label: 'Everything', onSelect: () => pickWhere(() => true) },
                  { label: 'Nothing', onSelect: () => pickWhere(() => false) },
                ],
                [{ label: 'Back to the defaults', disabled: !drafted, onSelect: reset }],
              ]"
            >
              <UButton
                size="sm"
                variant="outline"
                color="neutral"
                icon="i-lucide-list-checks"
                class="self-start"
                :disabled="busy === 'resolve'"
              >
                Pick by severity
              </UButton>
            </UDropdownMenu>
          </div>
          <p class="text-xs text-muted">{{ outcomeHint }}</p>
        </div>
        <AiReviewFindings
          :curation="curation"
          :challenged-finding-ids="run.challengedFindingIds"
          :picks="draft.picks"
          :outcome="draft.outcome"
          :awaiting="awaiting"
          :busy="busy"
          @pick="pick"
          @challenge="(findingId, question) => emit('challenge', findingId, question)"
        />
      </template>
    </div>

    <template v-if="awaiting && plan" #footer>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div class="text-sm">
          <p>{{ planTally(plan) }}</p>
          <p class="text-muted mt-1">Nothing reaches the pull request until you apply.</p>
        </div>
        <UButton
          :icon="plan.picked.length === 0 ? 'i-lucide-archive' : 'i-lucide-send'"
          :color="plan.picked.length === 0 ? 'neutral' : 'primary'"
          :disabled="busy !== null && busy !== 'resolve'"
          :loading="busy === 'resolve'"
          class="self-start sm:self-auto"
          @click="apply"
        >
          {{ applyLabel(plan) }}
        </UButton>
      </div>
    </template>
  </UCard>
</template>
