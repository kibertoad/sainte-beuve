<script setup lang="ts">
import type {
  EditGuidedReviewDraftInput,
  GuidedReviewCommentDraft,
  GuidedReviewSession,
} from '@sainte-beuve/contracts'

// One drafted comment: where it goes, what it says and why. A draft that can
// still be posted is editable in place (its body, and the line it sits on) and
// can be discarded; one that is posted links to the comment on the host.
const props = defineProps<{
  session: GuidedReviewSession
  draft: GuidedReviewCommentDraft
  prUrl: string | null
  selected: boolean
  /** Whether a call on this draft, or a post, is in flight. */
  busy: boolean
}>()

const emit = defineEmits<{
  'update:selected': [selected: boolean]
  edit: [input: EditGuidedReviewDraftInput]
}>()

type BadgeColor = 'info' | 'success' | 'error' | 'neutral' | 'warning'
const statusColor: Record<GuidedReviewCommentDraft['status'], BadgeColor> = {
  proposed: 'info',
  posting: 'warning',
  posted: 'success',
  failed: 'error',
  discarded: 'neutral',
}

const postable = computed(() => isPostable(props.draft))
const anchor = computed(() => ({
  path: props.draft.path,
  startLine: props.draft.startLine ?? props.draft.line,
  endLine: props.draft.line,
  side: props.draft.side,
}))

const editing = ref(false)
const body = ref('')
const line = ref(0)
/**
 * The draft as it stood when editing began. The stream can replace `draft`
 * mid-edit, and the edit has to go up against the revision it was made on, so
 * a change made elsewhere meanwhile is a 409 rather than overwritten.
 */
let base: Pick<GuidedReviewCommentDraft, 'rev' | 'body' | 'line'> | null = null

function startEditing(): void {
  const { rev, body: text, line: at } = props.draft
  base = { rev, body: text, line: at }
  body.value = text
  line.value = at
  editing.value = true
}

/**
 * Only what changed goes up. Moving the line drops a multi-line span to the one
 * line, since its start was chosen for the old position.
 */
function save(): void {
  if (base === null) return
  const input: EditGuidedReviewDraftInput = { rev: base.rev }
  const trimmed = body.value.trim()
  if (trimmed !== base.body) input.body = trimmed
  if (line.value !== base.line) {
    input.line = line.value
    input.startLine = null
  }
  editing.value = false
  if (input.body !== undefined || input.line !== undefined) emit('edit', input)
}

const toast = useToast()

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.draft.body)
    toast.add({ color: 'success', title: 'Comment copied' })
  } catch {
    toast.add({ color: 'error', title: 'Could not copy the comment' })
  }
}
</script>

<template>
  <div class="flex flex-col gap-2 rounded-md border border-default p-3">
    <div class="flex flex-wrap items-center gap-2">
      <UCheckbox
        v-if="postable"
        :model-value="selected"
        :disabled="busy"
        aria-label="Post this comment"
        @update:model-value="(value) => emit('update:selected', value === true)"
      />
      <GuidedReviewAnchorLink :session="session" :anchor="anchor" :pr-url="prUrl" />
      <UBadge :color="statusColor[draft.status]" variant="subtle" size="sm">
        {{ draft.status }}
      </UBadge>
    </div>

    <template v-if="editing">
      <UTextarea v-model="body" :rows="4" autoresize class="w-full" />
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <UFormField label="Line" class="w-full sm:w-32">
          <UInputNumber v-model="line" :min="1" class="w-full" />
        </UFormField>
        <div class="flex flex-wrap gap-2 sm:ml-auto">
          <UButton size="xs" variant="ghost" color="neutral" @click="editing = false">
            Cancel
          </UButton>
          <UButton size="xs" :disabled="body.trim().length === 0" @click="save">Save</UButton>
        </div>
      </div>
    </template>
    <p v-else class="text-sm whitespace-pre-line break-words">{{ draft.body }}</p>

    <p v-if="draft.rationale" class="text-xs text-muted whitespace-pre-line">
      {{ draft.rationale }}
    </p>
    <p v-if="draft.postError" class="text-xs text-error">{{ draft.postError }}</p>

    <div v-if="!editing" class="flex flex-wrap gap-2">
      <UButton
        v-if="postable"
        size="xs"
        variant="ghost"
        icon="i-lucide-pencil"
        :disabled="busy"
        @click="startEditing"
      >
        Edit
      </UButton>
      <UButton
        v-if="postable"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-trash-2"
        :disabled="busy"
        @click="emit('edit', { rev: draft.rev, discard: true })"
      >
        Discard
      </UButton>
      <UButton size="xs" variant="ghost" icon="i-lucide-copy" @click="copy">Copy</UButton>
      <UButton
        v-if="safeHref(draft.postedUrl)"
        :to="safeHref(draft.postedUrl)"
        target="_blank"
        size="xs"
        variant="ghost"
        icon="i-lucide-external-link"
      >
        Posted comment
      </UButton>
    </div>
  </div>
</template>
