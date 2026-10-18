<script setup lang="ts">
import type { AiReviewCuration, AiReviewFinding, AiReviewSeverity } from '@sainte-beuve/contracts'
import { challengedFindingIdsOf, AI_REVIEW_CHALLENGE_LIMIT } from '@sainte-beuve/contracts'
import type { FindingChoice, FindingChoices } from '../utils/aiReviewPlan'

// The findings of one AI review, grouped under the slice of the diff each came
// from, so a curator reads a refactor's findings together rather than in one
// list sorted by severity across the whole change.
const props = defineProps<{
  curation: AiReviewCuration
  challengedFindingIds: string[]
  choices: FindingChoices
  awaiting: boolean
  busy: string | null
}>()

const emit = defineEmits<{
  choose: [findingId: string, choice: FindingChoice]
  challenge: [findingId: string, question: string | null]
}>()

const SEVERITIES: AiReviewSeverity[] = ['blocker', 'high', 'medium', 'low', 'nit']
const shown = ref<Set<AiReviewSeverity>>(new Set(SEVERITIES))

function toggleSeverity(severity: AiReviewSeverity): void {
  const next = new Set(shown.value)
  if (!next.delete(severity)) next.add(severity)
  shown.value = next.size === 0 ? new Set(SEVERITIES) : next
}

const counts = computed(() => {
  const tally = new Map<AiReviewSeverity, number>()
  for (const finding of props.curation.findings) {
    tally.set(finding.severity, (tally.get(finding.severity) ?? 0) + 1)
  }
  return tally
})

interface Group {
  key: string
  title: string | null
  rationale: string | null
  findings: AiReviewFinding[]
}

const groups = computed<Group[]>(() => {
  const visible = props.curation.findings.filter((finding) => shown.value.has(finding.severity))
  const sliced = props.curation.slices.map((slice) => ({
    key: slice.sliceId,
    title: slice.title,
    rationale: slice.rationale,
    findings: visible.filter((finding) => finding.sliceId === slice.sliceId),
  }))
  const known = new Set(props.curation.slices.map((slice) => slice.sliceId))
  const loose = visible.filter((finding) => finding.sliceId === null || !known.has(finding.sliceId))
  const rest = {
    key: 'other',
    title: sliced.length === 0 ? null : 'Across the change',
    rationale: null,
    findings: loose,
  }
  return [...sliced, rest].filter((group) => group.findings.length > 0)
})

const challengesSpent = computed(
  () =>
    challengedFindingIdsOf({
      curation: props.curation,
      challengedFindingIds: props.challengedFindingIds,
    }).size >= AI_REVIEW_CHALLENGE_LIMIT,
)

const posted = computed(() => new Set(props.curation.postedFindingIds))
const queued = computed(() => new Set(props.curation.fixFindingIds))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-muted">Show</span>
      <UButton
        v-for="severity in SEVERITIES"
        :key="severity"
        size="xs"
        :variant="shown.has(severity) ? 'soft' : 'ghost'"
        :color="shown.has(severity) ? 'primary' : 'neutral'"
        :disabled="!counts.get(severity)"
        @click="toggleSeverity(severity)"
      >
        {{ severity }} {{ counts.get(severity) ?? 0 }}
      </UButton>
    </div>

    <section v-for="group in groups" :key="group.key" class="flex flex-col gap-2">
      <div v-if="group.title">
        <h3 class="text-sm font-semibold">{{ group.title }}</h3>
        <p v-if="group.rationale" class="text-xs text-muted">{{ group.rationale }}</p>
      </div>
      <div class="flex flex-col divide-y divide-default">
        <AiReviewFindingRow
          v-for="finding in group.findings"
          :key="finding.findingId"
          :finding="finding"
          :choice="choices[finding.findingId] ?? 'ignore'"
          :awaiting="awaiting"
          :posted="posted.has(finding.findingId)"
          :queued-for-fix="queued.has(finding.findingId) && curation.status === 'posting'"
          :challenges-spent="challengesSpent"
          :busy="busy"
          @choose="(choice) => emit('choose', finding.findingId, choice)"
          @challenge="(question) => emit('challenge', finding.findingId, question)"
        />
      </div>
    </section>
  </div>
</template>
