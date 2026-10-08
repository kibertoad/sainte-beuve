<script setup lang="ts">
import type { GuidedReviewSession } from '@sainte-beuve/contracts'

// cat-factory's explanation of a pull request: what it is for, what changed,
// what it affects, what could go wrong, and where to look first. Each section
// renders only when the model said something in it, because an empty heading
// reads as "nothing to worry about" when it means "nothing was said".
const props = defineProps<{
  session: GuidedReviewSession
  prUrl: string | null
  /** Whether a suggested question can be asked now. */
  canAsk: boolean
}>()

const emit = defineEmits<{ ask: [question: string] }>()

const overview = computed(() => props.session.overview)
const content = computed(() => overview.value.content)

type BadgeColor = 'error' | 'warning' | 'neutral'
const severityColor: Record<'high' | 'medium' | 'low', BadgeColor> = {
  high: 'error',
  medium: 'warning',
  low: 'neutral',
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="overview.status === 'pending' || overview.status === 'running'"
      class="flex items-center gap-2 text-sm text-muted"
    >
      <UIcon name="i-lucide-loader-circle" class="animate-spin" />
      cat-factory is reading the pull request. The overview appears here when it is done.
    </div>

    <UAlert
      v-else-if="overview.status === 'failed' && overview.failure"
      color="error"
      variant="subtle"
      title="The overview could not be generated"
      :description="failureLabel(overview.failure.reason)"
    />

    <template v-if="content">
      <section class="flex flex-col gap-1">
        <h3 class="font-medium">Summary</h3>
        <p class="text-sm whitespace-pre-line">{{ content.summary }}</p>
        <p v-if="content.intent" class="text-sm text-muted whitespace-pre-line">
          {{ content.intent }}
        </p>
      </section>

      <section v-if="content.focusAreas.length > 0" class="flex flex-col gap-2">
        <h3 class="font-medium">Where to look first</h3>
        <div v-for="area in content.focusAreas" :key="area.title" class="flex flex-col gap-1">
          <p class="text-sm font-medium">{{ area.title }}</p>
          <p class="text-sm text-muted whitespace-pre-line">{{ area.why }}</p>
          <div v-if="area.anchors.length > 0" class="flex flex-wrap gap-1">
            <GuidedReviewAnchorLink
              v-for="anchor in area.anchors"
              :key="anchorLabel(anchor)"
              :session="session"
              :anchor="anchor"
              :pr-url="prUrl"
            />
          </div>
        </div>
      </section>

      <section v-if="content.risks.length > 0" class="flex flex-col gap-2">
        <h3 class="font-medium">Risks</h3>
        <div v-for="risk in content.risks" :key="risk.title" class="flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge :color="severityColor[risk.severity]" variant="subtle" size="sm">
              {{ risk.severity }}
            </UBadge>
            <p class="text-sm font-medium">{{ risk.title }}</p>
          </div>
          <p class="text-sm text-muted whitespace-pre-line">{{ risk.detail }}</p>
          <p v-if="risk.paths.length > 0" class="text-xs text-muted font-mono break-all">
            {{ risk.paths.join(', ') }}
          </p>
        </div>
      </section>

      <section v-if="content.meaningfulChanges.length > 0" class="flex flex-col gap-2">
        <h3 class="font-medium">What changed</h3>
        <div v-for="change in content.meaningfulChanges" :key="change.title">
          <p class="text-sm font-medium">{{ change.title }}</p>
          <p class="text-sm text-muted whitespace-pre-line">{{ change.detail }}</p>
          <p v-if="change.paths.length > 0" class="text-xs text-muted font-mono break-all">
            {{ change.paths.join(', ') }}
          </p>
        </div>
      </section>

      <section v-if="content.consequences.length > 0" class="flex flex-col gap-2">
        <h3 class="font-medium">Consequences</h3>
        <div v-for="consequence in content.consequences" :key="consequence.title">
          <p class="text-sm font-medium">{{ consequence.title }}</p>
          <p class="text-sm text-muted whitespace-pre-line">{{ consequence.detail }}</p>
        </div>
      </section>

      <section v-if="content.suggestedQuestions.length > 0" class="flex flex-col gap-2">
        <h3 class="font-medium">Questions worth asking</h3>
        <p class="text-xs text-muted">Each one opens a thread of its own.</p>
        <div class="flex flex-col items-start gap-1">
          <UButton
            v-for="suggestion in content.suggestedQuestions"
            :key="suggestion.id"
            size="sm"
            variant="soft"
            icon="i-lucide-message-circle-question"
            class="text-left whitespace-normal"
            :disabled="!canAsk"
            @click="emit('ask', suggestion.question)"
          >
            {{ suggestion.question }}
          </UButton>
        </div>
      </section>
    </template>
  </div>
</template>
