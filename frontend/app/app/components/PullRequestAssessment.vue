<script setup lang="ts">
import type { PullRequestRef, RiskAxis } from '@sainte-beuve/contracts'

// A pull request's risk, impact and complexity from cat-factory's assessor, or
// the button that asks for them. Assessing scores only: it approves nothing and
// puts nothing on the board.
const props = defineProps<{ pullRequest: PullRequestRef }>()

const api = useSainteBeuveApi()
const capabilities = useCapabilities()
const { known, want, remember } = usePullRequestAssessments()
const { busy, run } = useApiAction()

watch(
  () => props.pullRequest.url,
  () => want(props.pullRequest),
  { immediate: true },
)

const assessment = computed(() => known.value[props.pullRequest.url] ?? null)

const AXES: { axis: RiskAxis; label: string }[] = [
  { axis: 'risk', label: 'Risk' },
  { axis: 'impact', label: 'Impact' },
  { axis: 'complexity', label: 'Complexity' },
]

/** The same thresholds a reader would draw: a third of the way up is worth a look, two thirds a warning. */
function colorOf(score: number): 'success' | 'warning' | 'error' {
  if (score >= 2 / 3) return 'error'
  return score >= 1 / 3 ? 'warning' : 'success'
}

async function assess(): Promise<void> {
  await run(
    async () => remember(await api.assessPullRequest(props.pullRequest)),
    'Could not assess the pull request',
    'assess',
  )
}
</script>

<template>
  <div
    v-if="assessment"
    class="flex flex-wrap items-center gap-1"
    :title="assessment.rationale ?? undefined"
  >
    <UBadge
      v-for="{ axis, label } in AXES"
      :key="axis"
      :color="colorOf(assessment.scores[axis])"
      variant="subtle"
      size="sm"
    >
      {{ label }} {{ Math.round(assessment.scores[axis] * 100) }}%
    </UBadge>
  </div>
  <UButton
    v-else-if="assessment === null && capabilities.confirmed('externalRiskAssessment')"
    size="sm"
    variant="ghost"
    icon="i-lucide-gauge"
    :loading="busy === 'assess'"
    @click="assess()"
  >
    Assess
  </UButton>
</template>
