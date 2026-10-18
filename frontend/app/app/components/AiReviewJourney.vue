<script setup lang="ts">
import type { AiReviewRun } from '@sainte-beuve/contracts'
import { activityLine, journeyOf, progressFraction } from '../utils/aiReviewPlan'

// Where one AI review stands: the steps it goes through, what cat-factory is
// doing right now, and the one recovery a person can make while it works.
const props = defineProps<{
  run: AiReviewRun
  busy: string | null
}>()

const emit = defineEmits<{ resume: [] }>()

const steps = computed(() => journeyOf(props.run))
const activity = computed(() => activityLine(props.run))
const fraction = computed(() => progressFraction(props.run))

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 15000)
})
onUnmounted(() => {
  if (clock !== null) clearInterval(clock)
})

const heardFrom = computed(() => {
  const at = props.run.curation?.lastActivityAt
  if (at === null || at === undefined || props.run.status !== 'running') return null
  const age = relativeAge(at, now.value)
  return age === 'just now' ? 'heard from just now' : `last heard from ${age} ago`
})

/**
 * Whether the reviewer looks stuck rather than slow: every slice is in and no
 * findings have come back, which is the final aggregation turn, the one that
 * can wedge with all the work done. Not a staleness verdict, so it offers the
 * button and leaves the judgement to whoever is watching.
 */
const mayResume = computed(() => {
  const state = props.run.curation
  if (state === null || state.status !== 'reviewing') return false
  if (state.sliceCount === 0 || state.reportedSliceCount < state.sliceCount) return false
  return state.resumeAttempts < state.maxResumeAttempts
})

const stepIcon: Record<string, string> = {
  done: 'i-lucide-circle-check',
  current: 'i-lucide-circle-dot',
  upcoming: 'i-lucide-circle',
  failed: 'i-lucide-circle-x',
}

const stepClass: Record<string, string> = {
  done: 'text-success',
  current: 'text-primary font-medium',
  upcoming: 'text-muted',
  failed: 'text-error font-medium',
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <ol class="grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-3">
      <li
        v-for="step in steps"
        :key="step.key"
        class="flex items-center gap-2 text-sm"
        :class="stepClass[step.state]"
      >
        <UIcon :name="stepIcon[step.state]" class="size-4 shrink-0" />
        <span>{{ step.label }}</span>
      </li>
    </ol>
    <div v-if="activity || fraction !== null" class="flex flex-col gap-2">
      <UProgress
        v-if="run.status === 'running' || run.status === 'requested'"
        :model-value="fraction === null ? null : Math.round(fraction * 100)"
        size="sm"
      />
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm text-muted">
          {{ activity }}
          <span v-if="heardFrom" class="text-xs">({{ heardFrom }})</span>
        </p>
        <UButton
          v-if="mayResume"
          size="sm"
          variant="soft"
          color="warning"
          icon="i-lucide-rotate-cw"
          class="self-start sm:self-auto"
          :loading="busy === 'resume'"
          @click="emit('resume')"
        >
          Resume the stalled slices
        </UButton>
      </div>
    </div>
  </div>
</template>
