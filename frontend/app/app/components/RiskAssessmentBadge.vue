<script setup lang="ts">
import type { RiskAssessment } from '@sainte-beuve/contracts'

// Where a board row's risk assessment stands, with the reading behind it on hover.
const props = defineProps<{ assessment: RiskAssessment }>()

type BadgeColor = 'error' | 'info' | 'success' | 'warning' | 'neutral'

const LOOK: Record<RiskAssessment['status'], { label: string; color: BadgeColor }> = {
  pending: { label: 'Assessing', color: 'neutral' },
  awaiting_ai_review: { label: 'Within policy, AI review running', color: 'info' },
  approved: { label: 'Approved unattended', color: 'success' },
  within_policy: { label: 'Within policy', color: 'success' },
  requires_review: { label: 'Needs a person', color: 'warning' },
  failed: { label: 'Not assessed', color: 'error' },
}

/** A status this build does not know reads as its slug: the API can be newer than the SPA. */
const look = computed(
  () =>
    (LOOK as Partial<Record<string, { label: string; color: BadgeColor }>>)[
      props.assessment.status
    ] ?? { label: props.assessment.status, color: 'neutral' as const },
)

const detail = computed(() => {
  const { scores, changeClass, verdict, holdReason, rationale } = props.assessment
  const lines: string[] = []
  if (scores !== null) {
    lines.push(
      `Complexity ${scores.complexity}, risk ${scores.risk}, impact ${scores.impact}` +
        (changeClass === null ? '' : ` (${changeClass})`),
    )
  }
  if (verdict !== null) lines.push(`Judged by the ${verdict.policyName} policy`)
  if (verdict !== null && verdict.exceededAxes.length > 0) {
    lines.push(`Over the ceiling on ${verdict.exceededAxes.join(', ')}`)
  }
  if (holdReason !== null) lines.push(holdReason)
  else if (rationale !== null) lines.push(rationale)
  return lines.join('. ')
})
</script>

<template>
  <UTooltip :text="detail" :disabled="detail.length === 0">
    <UBadge :color="look.color" variant="subtle" size="sm" icon="i-lucide-shield-check">
      {{ look.label }}
    </UBadge>
  </UTooltip>
</template>
