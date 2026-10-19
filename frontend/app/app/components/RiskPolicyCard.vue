<script setup lang="ts">
import type {
  AiReviewSeverity,
  ChangeClassRule,
  ExternalRiskPolicyList,
  RiskAssessor,
  RiskPolicy,
  RiskPolicySource,
  RuleableChangeClass,
} from '@sainte-beuve/contracts'
import { AI_REVIEW_SEVERITY_PENALTY, RULEABLE_CHANGE_CLASSES } from '@sainte-beuve/contracts'

// The org's risk policy: whether pull requests are assessed, who scores them,
// which scores pass, whether every new one gets an AI review, and whether a pass
// is approved with nobody looking.
const props = defineProps<{
  policy: RiskPolicy
  catFactoryAvailable: boolean
  /** The cat-factory policies to pick from; null until they are read. */
  externalPolicies: ExternalRiskPolicyList | null
  admin: boolean
  busy: boolean
}>()

const emit = defineEmits<{ save: [policy: RiskPolicy] }>()

const draft = ref<RiskPolicy>(structuredClone(toRaw(props.policy)))

watch(
  () => props.policy,
  (policy) => {
    draft.value = structuredClone(toRaw(policy))
  },
)

const assessors = computed(() => [
  { label: 'From the changed files', value: 'heuristic' satisfies RiskAssessor },
  {
    label: 'cat-factory',
    value: 'cat-factory' satisfies RiskAssessor,
    disabled: !props.catFactoryAvailable,
  },
])

const sources: { label: string; value: RiskPolicySource }[] = [
  { label: 'This org’s ceilings', value: 'native' },
  { label: 'A cat-factory risk policy', value: 'cat-factory' },
]

const UNATTENDED_DEFAULT = '__unattended_default__'

const externalChoices = computed(() => [
  { label: 'cat-factory’s default for unattended work', value: UNATTENDED_DEFAULT },
  ...(props.externalPolicies?.policies ?? []).map((policy) => ({
    label: policy.autoMergeEnabled ? policy.name : `${policy.name} (never lands unattended)`,
    value: policy.policyId,
  })),
])

const externalPolicy = computed({
  get: () => draft.value.catFactoryPolicyId ?? UNATTENDED_DEFAULT,
  set: (value: string) => {
    draft.value.catFactoryPolicyId = value === UNATTENDED_DEFAULT ? null : value
  },
})

const ruleChoices: { label: string; value: ChangeClassRule }[] = [
  { label: 'Compare the scores', value: 'thresholds' },
  { label: 'Always passes', value: 'always' },
  { label: 'Always needs a person', value: 'never' },
]

const CLASS_LABEL: Record<RuleableChangeClass, string> = {
  docs: 'Documentation and copy',
  test: 'Tests only',
  dependency: 'Dependency bumps',
  config: 'CI and tooling',
  source: 'Code',
  schema: 'Schema and migrations',
}

function ruleOf(changeClass: RuleableChangeClass): ChangeClassRule {
  return draft.value.classRules[changeClass] ?? 'thresholds'
}

function setRule(changeClass: RuleableChangeClass, rule: ChangeClassRule) {
  const { [changeClass]: _dropped, ...rest } = draft.value.classRules
  draft.value.classRules = rule === 'thresholds' ? rest : { ...rest, [changeClass]: rule }
}

const severities: { label: string; value: AiReviewSeverity }[] = [
  { label: 'Blocker', value: 'blocker' },
  { label: 'High or worse', value: 'high' },
  { label: 'Medium or worse', value: 'medium' },
  { label: 'Low or worse', value: 'low' },
  { label: 'Anything at all', value: 'nit' },
]

const usesCatFactoryPolicy = computed(
  () => draft.value.assessor === 'cat-factory' && draft.value.policySource === 'cat-factory',
)

// A cat-factory policy judges only what cat-factory scored, so the two move together.
watch(
  () => draft.value.assessor,
  (assessor) => {
    if (assessor === 'heuristic') draft.value.policySource = 'native'
  },
)

// What each finding costs the rating, as the minimum's description says it.
const ratingCosts = (['high', 'medium', 'low', 'nit'] as const)
  .map((severity) => `${severity} ${AI_REVIEW_SEVERITY_PENALTY[severity]}`)
  .join(', ')

/**
 * A switch that needs cat-factory stays reachable while it is on, so an org that
 * lost its connection can still turn it off.
 */
function needsCatFactory(on: boolean): boolean {
  return !props.admin || (!props.catFactoryAvailable && !on)
}

const ceilings: { key: 'maxComplexity' | 'maxRisk' | 'maxImpact'; label: string }[] = [
  { key: 'maxComplexity', label: 'Complexity' },
  { key: 'maxRisk', label: 'Risk' },
  { key: 'maxImpact', label: 'Impact' },
]
</script>

<template>
  <UCard>
    <div class="mb-4">
      <p class="font-medium">Risk policy</p>
      <p class="text-sm text-muted">
        Every pull request the board tracks can be scored from 0 to 1 on complexity, risk and
        impact. One within the policy can be approved with nobody looking.
      </p>
    </div>

    <div class="flex flex-col gap-5 max-w-2xl">
      <USwitch
        v-model="draft.assess"
        label="Assess a pull request when it opens, or when it leaves draft"
        description="Any pull request the board starts tracking is assessed too. A draft is scored but never approved."
        :disabled="!admin"
      />

      <USwitch
        v-model="draft.autoAiReview"
        label="Run cat-factory's AI review when a pull request opens, or when it leaves draft"
        description="Drafts wait until they are marked ready. Its findings park on the AI review screen for a person, unless an approval below settles the review."
        :disabled="needsCatFactory(draft.autoAiReview)"
      />

      <template v-if="draft.assess">
        <UFormField
          label="Who scores it"
          description="From the changed files is a deterministic reading: it trusts small documentation and test changes and little else. cat-factory reads the change with a model."
        >
          <USelect
            v-model="draft.assessor"
            :items="assessors"
            value-key="value"
            class="w-full sm:w-64"
            :disabled="!admin"
          />
        </UFormField>

        <UFormField
          v-if="draft.assessor === 'cat-factory'"
          label="Which ceilings it is held to"
          description="A cat-factory risk policy gives its own verdict: its ceilings and its rules per kind of change, the same ones its own merges are held to."
        >
          <USelect
            v-model="draft.policySource"
            :items="sources"
            value-key="value"
            class="w-full sm:w-64"
            :disabled="!admin"
          />
        </UFormField>

        <UFormField v-if="usesCatFactoryPolicy" label="cat-factory risk policy">
          <USelect
            v-model="externalPolicy"
            :items="externalChoices"
            value-key="value"
            class="w-full sm:w-80"
            :disabled="!admin"
          />
          <UAlert
            v-if="externalPolicies?.unavailableReason"
            class="mt-2"
            color="warning"
            variant="subtle"
            title="The cat-factory policies could not be listed"
            :description="externalPolicies.unavailableReason"
          />
        </UFormField>

        <template v-else>
          <UFormField
            label="Ceilings"
            description="A pull request passes when every score is at or below its ceiling."
          >
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <UFormField v-for="ceiling in ceilings" :key="ceiling.key" :label="ceiling.label">
                <UInputNumber
                  v-model="draft[ceiling.key]"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  class="w-full"
                  :disabled="!admin"
                />
              </UFormField>
            </div>
          </UFormField>

          <UFormField
            label="Per kind of change"
            description="Read from the changed paths. A change that mixes kinds counts as the riskiest one it contains."
          >
            <div class="flex flex-col gap-2">
              <div
                v-for="changeClass in RULEABLE_CHANGE_CLASSES"
                :key="changeClass"
                class="grid grid-cols-1 items-center gap-1 sm:grid-cols-[12rem_1fr] sm:gap-3"
              >
                <span class="text-sm">{{ CLASS_LABEL[changeClass] }}</span>
                <USelect
                  :model-value="ruleOf(changeClass)"
                  :items="ruleChoices"
                  value-key="value"
                  class="w-full sm:w-64"
                  :disabled="!admin"
                  @update:model-value="setRule(changeClass, $event as ChangeClassRule)"
                />
              </div>
            </div>
          </UFormField>
        </template>

        <USwitch
          v-model="draft.autoApprove"
          label="Approve a pull request within the policy, with nobody looking"
          description="Approved as the approver configured below. Its approval is withdrawn when new commits arrive, and the new head is assessed again."
          :disabled="!admin"
        />

        <template v-if="draft.autoApprove">
          <USwitch
            v-model="draft.requireAiReview"
            label="Wait for cat-factory's AI review, and approve only if it rates the change well enough"
            description="The review filed when the pull request opened is the one waited on, when there is one."
            :disabled="needsCatFactory(draft.requireAiReview)"
          />
          <template v-if="draft.requireAiReview">
            <UFormField
              label="A finding that holds it for a person"
              description="The review stays parked with its findings for a person to curate."
            >
              <USelect
                v-model="draft.blockingSeverity"
                :items="severities"
                value-key="value"
                class="w-full sm:w-64"
                :disabled="!admin"
              />
            </UFormField>
            <UFormField
              label="Lowest rating it may give"
              :description="`From 0 to 1. A review that found nothing rates 1, and each finding takes off what its severity costs (${ratingCosts}). cat-factory's own reviewer passes at 0.8.`"
            >
              <UInputNumber
                v-model="draft.minAiReviewRating"
                :min="0"
                :max="1"
                :step="0.05"
                class="w-full sm:w-40"
                :disabled="!admin"
              />
            </UFormField>
          </template>
        </template>
      </template>

      <div v-if="admin" class="flex justify-end">
        <UButton :loading="busy" @click="emit('save', draft)">Save</UButton>
      </div>
      <p v-else class="text-sm text-muted">Only an admin can change the risk policy.</p>
    </div>
  </UCard>
</template>
