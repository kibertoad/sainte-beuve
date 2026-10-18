<script setup lang="ts">
import type { AiReviewRun, ResolveAiReviewInput } from '@sainte-beuve/contracts'
import { applyLabel, type FindingChoice, planOf } from '../utils/aiReviewPlan'
import { aiReviewStatusColor, aiReviewStatusLabel } from '../utils/aiReviewStatus'

// One delegated review, followed from filing to the last comment or commit.
//
// The screen exists for the parked state: cat-factory hands back what it found
// and does nothing until somebody says what each finding deserves (a comment, a
// fix, or nothing). Everything else here is context for that decision.
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
const { choices, choose, chooseWhere, reset, drafted } = useFindingChoices(() => props.run)
const plan = computed(() =>
  curation.value === null ? null : planOf(curation.value, choices.value),
)

function chooseSeverities(severities: string[], choice: FindingChoice): void {
  chooseWhere((finding) => severities.includes(finding.severity), choice)
}

function apply(): void {
  const resolution = plan.value?.resolution
  if (resolution) emit('resolve', resolution, reset)
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
        <div
          v-if="awaiting"
          class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <p class="text-sm">
            Decide what each finding deserves: a comment on the pull request, a fix committed by
            cat-factory, or nothing.
          </p>
          <UDropdownMenu
            :items="[
              [
                {
                  label: 'Blockers and highs: fix',
                  onSelect: () => chooseSeverities(['blocker', 'high'], 'fix'),
                },
                {
                  label: 'Blockers and highs: comment',
                  onSelect: () => chooseSeverities(['blocker', 'high'], 'comment'),
                },
                {
                  label: 'Mediums: comment',
                  onSelect: () => chooseSeverities(['medium'], 'comment'),
                },
                {
                  label: 'Lows and nits: ignore',
                  onSelect: () => chooseSeverities(['low', 'nit'], 'ignore'),
                },
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
              Choose by severity
            </UButton>
          </UDropdownMenu>
        </div>
        <AiReviewFindings
          :curation="curation"
          :challenged-finding-ids="run.challengedFindingIds"
          :choices="choices"
          :awaiting="awaiting"
          :busy="busy"
          @choose="choose"
          @challenge="(findingId, question) => emit('challenge', findingId, question)"
        />
      </template>
    </div>

    <template v-if="awaiting && plan" #footer>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div class="text-sm">
          <p>
            {{ plan.comment.length }} to comment &middot; {{ plan.fix.length }} to fix &middot;
            {{ plan.ignore.length }} ignored
          </p>
          <p v-if="plan.blocked" class="text-error mt-1">{{ plan.blocked }}</p>
          <p v-else class="text-muted mt-1">Nothing reaches the pull request until you apply.</p>
        </div>
        <UButton
          :icon="plan.comment.length + plan.fix.length === 0 ? 'i-lucide-archive' : 'i-lucide-send'"
          :color="plan.comment.length + plan.fix.length === 0 ? 'neutral' : 'primary'"
          :disabled="plan.resolution === null || (busy !== null && busy !== 'resolve')"
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
