<script setup lang="ts">
import type {
  AiReviewFinding,
  AiReviewResolution,
  AiReviewRun,
  AiReviewSeverity,
} from '@sainte-beuve/contracts'

// One delegated review, and the loop it is in the middle of.
//
// The screen exists for the parked state: cat-factory hands back what it found
// and posts nothing until somebody says which of the findings are worth a
// comment. Everything else here is context for that decision, which is why the
// severities are on the left and the checkboxes are the only control in the row.
const props = defineProps<{
  run: AiReviewRun
  /** Which action is mid-flight on this run, so one button spins and the rest lock. */
  busy: string | null
}>()

const emit = defineEmits<{
  dismiss: [findingId: string]
  resolve: [action: AiReviewResolution, findingIds: string[]]
  resume: []
}>()

type BadgeColor = 'error' | 'warning' | 'info' | 'success' | 'neutral'

const statusColor: Record<AiReviewRun['status'], BadgeColor> = {
  requested: 'neutral',
  running: 'info',
  // The one status that is waiting on a PERSON, so it reads like the others do
  // not: everything else on this card is a report, and this is a request.
  awaiting_selection: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
}

const severityColor: Record<AiReviewSeverity, BadgeColor> = {
  blocker: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
  nit: 'neutral',
}

const curation = computed(() => props.run.curation)
const findings = computed<AiReviewFinding[]>(() => curation.value?.findings ?? [])

/** Which findings are going onto the pull request. Everything blocking, to start. */
const selected = ref(new Set<string>())
const seeded = ref(false)

watchEffect(() => {
  if (seeded.value || findings.value.length === 0) return
  seeded.value = true
  // A default of "the ones the reviewer called blocking or high" rather than all
  // or nothing: an empty list makes somebody tick eight boxes to do the obvious
  // thing, and a full one makes Post the button that publishes the nits too.
  selected.value = new Set(
    findings.value
      .filter((finding) => finding.severity === 'blocker' || finding.severity === 'high')
      .map((finding) => finding.findingId),
  )
})

function toggle(findingId: string): void {
  const next = new Set(selected.value)
  if (!next.delete(findingId)) next.add(findingId)
  selected.value = next
}

const selectedIds = computed(() =>
  findings.value.map((f) => f.findingId).filter((id) => selected.value.has(id)),
)

const awaiting = computed(() => props.run.status === 'awaiting_selection')

/** A finding already on the pull request. Re-posting the selection skips it. */
const posted = computed(() => new Set(curation.value?.postedFindingIds ?? []))

/**
 * Whether the reviewer looks stuck rather than slow.
 *
 * Every slice has reported and nothing has been emitted, which means the run is
 * on its final aggregation turn. That is the turn that can wedge with all the
 * work done, and it is the only one a resume can recover. It is NOT a staleness
 * verdict: the heartbeat freezes on a long silent turn too, so this offers the
 * button and leaves the judgement to whoever is watching.
 */
const mayResume = computed(() => {
  const state = curation.value
  if (state === null || state.status !== 'reviewing') return false
  if (state.sliceCount === 0 || state.reportedSliceCount < state.sliceCount) return false
  return state.resumeAttempts < state.maxResumeAttempts
})

const report = computed(() => curation.value?.postReport ?? null)

/** What the last posting pass actually landed, in one line. */
const reportLine = computed(() => {
  const it = report.value
  if (it === null) return null
  const attempt = it.attempt === null ? 'The last pass' : `Attempt ${it.attempt}`
  const folded = it.folded === 0 ? '' : `, ${it.folded} folded into the summary comment`
  return `${attempt} posted ${it.posted} of ${it.attempted} comments${folded}.`
})

function lineOf(finding: { path: string; line: number | null }): string {
  return finding.line === null ? finding.path : `${finding.path}:${finding.line}`
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <UBadge :color="statusColor[run.status]" variant="subtle">
              {{ run.status.replace('_', ' ') }}
            </UBadge>
            <span
              v-if="curation && curation.status !== 'awaiting_selection'"
              class="text-xs text-muted"
            >
              {{ curation.status }}
            </span>
            <span v-if="curation && curation.sliceCount > 0" class="text-xs text-muted">
              {{ curation.reportedSliceCount }}/{{ curation.sliceCount }} slices in
            </span>
          </div>
          <p v-if="run.summary" class="text-sm mt-2">{{ run.summary }}</p>
          <p v-if="run.failureReason" class="text-sm text-error mt-2">{{ run.failureReason }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <UButton
            v-if="mayResume"
            size="sm"
            variant="soft"
            color="warning"
            icon="i-lucide-rotate-cw"
            :loading="busy === 'resume'"
            @click="emit('resume')"
          >
            Resume
          </UButton>
          <UButton
            v-if="run.catFactoryUrl"
            :to="run.catFactoryUrl"
            target="_blank"
            size="sm"
            variant="ghost"
            icon="i-lucide-external-link"
          >
            cat-factory
          </UButton>
        </div>
      </div>
    </template>

    <UAlert
      v-if="report && (report.failures.length > 0 || report.bodyError)"
      class="mb-4"
      color="error"
      variant="subtle"
      icon="i-lucide-message-square-x"
      title="Some comments did not land"
    >
      <template #description>
        <p>{{ reportLine }}</p>
        <p v-if="report.bodyError" class="mt-1">Summary comment: {{ report.bodyError }}</p>
        <ul v-if="report.failures.length > 0" class="mt-2 list-disc pl-4">
          <li v-for="failure in report.failures" :key="failure.findingId">
            <span class="font-mono text-xs">{{ lineOf(failure) }}</span
            >: {{ failure.reason }}
          </li>
        </ul>
        <p class="mt-2 text-xs">
          Posting again skips what already landed, so the same selection cannot double-comment.
        </p>
      </template>
    </UAlert>

    <UAlert
      v-else-if="reportLine"
      class="mb-4"
      color="success"
      variant="subtle"
      icon="i-lucide-message-square-check"
      title="Comments posted"
      :description="reportLine"
    />

    <p v-if="findings.length === 0" class="text-sm text-muted">
      {{
        run.status === 'completed'
          ? 'The review finished with nothing left to curate.'
          : 'No findings yet. cat-factory reports them once every slice of the diff is in.'
      }}
    </p>

    <div v-else class="flex flex-col divide-y divide-default">
      <div
        v-for="finding in findings"
        :key="finding.findingId"
        class="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
      >
        <UCheckbox
          :model-value="selected.has(finding.findingId)"
          :disabled="!awaiting"
          class="mt-1"
          @update:model-value="toggle(finding.findingId)"
        />
        <div class="min-w-0 grow">
          <div class="flex items-center gap-2 flex-wrap">
            <UBadge :color="severityColor[finding.severity]" size="sm" variant="subtle">
              {{ finding.severity }}
            </UBadge>
            <UBadge size="sm" variant="subtle" color="neutral">{{ finding.category }}</UBadge>
            <span class="font-medium">{{ finding.title }}</span>
            <UBadge v-if="posted.has(finding.findingId)" size="sm" variant="subtle" color="success">
              posted
            </UBadge>
          </div>
          <p class="font-mono text-xs text-muted mt-1">{{ lineOf(finding) }}</p>
          <p class="text-sm mt-1 whitespace-pre-wrap">{{ finding.detail }}</p>
          <pre
            v-if="finding.suggestedFix"
            class="text-xs mt-2 p-2 rounded bg-elevated overflow-x-auto"
            >{{ finding.suggestedFix }}</pre>
        </div>
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-lucide-x"
          :disabled="!awaiting"
          :loading="busy === finding.findingId"
          @click="emit('dismiss', finding.findingId)"
        >
          Dismiss
        </UButton>
      </div>
    </div>

    <template v-if="awaiting" #footer>
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <p class="text-sm text-muted">
          {{ selectedIds.length }} of {{ findings.length }} selected. Nothing reaches the pull
          request until you say so.
        </p>
        <div class="flex items-center gap-2">
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            :loading="busy === 'finish'"
            @click="emit('resolve', 'finish', [])"
          >
            Finish without posting
          </UButton>
          <UButton
            size="sm"
            variant="soft"
            icon="i-lucide-wrench"
            :disabled="selectedIds.length === 0"
            :loading="busy === 'fix'"
            @click="emit('resolve', 'fix', selectedIds)"
          >
            Send to a fixer
          </UButton>
          <UButton
            size="sm"
            icon="i-lucide-message-square-plus"
            :disabled="selectedIds.length === 0"
            :loading="busy === 'post'"
            @click="emit('resolve', 'post', selectedIds)"
          >
            Post {{ selectedIds.length }} inline
          </UButton>
        </div>
      </div>
    </template>
  </UCard>
</template>
