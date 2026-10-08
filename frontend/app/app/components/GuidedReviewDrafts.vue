<script setup lang="ts">
import type {
  EditGuidedReviewDraftInput,
  GuidedReviewCommentDraft,
  GuidedReviewSession,
} from '@sainte-beuve/contracts'

// The review comments cat-factory drafted from the threads, each on the line it
// is about. You edit them, drop the ones not worth saying, and post the rest on
// the pull request as plain comments: posting never approves or requests
// changes. cat-factory posts them as its own workspace, since this deployment's
// key belongs to no person.
const props = defineProps<{
  session: GuidedReviewSession
  drafts: GuidedReviewCommentDraft[]
  prUrl: string | null
}>()

/** The drafts moved on the cat-factory side: an edit, a discard or a post. */
const emit = defineEmits<{ changed: [] }>()

const api = useSainteBeuveApi()
const toast = useToast()
const { confirm } = useConfirm()

const visible = computed(() => props.drafts.filter((entry) => entry.status !== 'discarded'))

/**
 * Ticked by default, the way a parked AI review's blockers are: a draft exists
 * because somebody asked for it. A draft the reviewer unticks stays unticked
 * across the refreshes that follow.
 */
const unticked = ref(new Set<string>())
const selected = computed(() =>
  visible.value.filter((entry) => isPostable(entry) && !unticked.value.has(entry.id)),
)

function select(draftId: string, on: boolean): void {
  const next = new Set(unticked.value)
  if (on) next.delete(draftId)
  else next.add(draftId)
  unticked.value = next
}

const busy = ref<string | null>(null)
const summary = ref('')

async function attempt(key: string, failure: string, action: () => Promise<void>): Promise<void> {
  busy.value = key
  try {
    await action()
  } catch (err) {
    toast.add({ color: 'error', title: failure, description: refusalMessage(err) })
  } finally {
    busy.value = null
    // A refused edit is usually a draft that moved, so the reload is the fix either way.
    emit('changed')
  }
}

function edit(draftId: string, input: EditGuidedReviewDraftInput): Promise<void> {
  const failure = input.discard ? 'Could not discard the draft' : 'Could not save the draft'
  return attempt(draftId, failure, async () => {
    await api.editGuidedReviewDraft(props.session.id, draftId, input)
  })
}

async function postSelected(): Promise<void> {
  const draftIds = selected.value.map((entry) => entry.id)
  const count = draftIds.length
  const go = await confirm({
    title: count === 1 ? 'Post this comment?' : `Post ${count} comments?`,
    description:
      'They go on the pull request as review comments from cat-factory, on the lines they are ' +
      'anchored to. Posting does not approve or request changes.',
    confirmLabel: 'Post',
  })
  if (!go) return
  await attempt('post', 'Could not post the comments', async () => {
    const result = await api.postGuidedReviewDrafts(
      props.session.id,
      draftIds,
      summary.value.trim(),
    )
    if (result.failed === 0) summary.value = ''
    toast.add({
      color: result.failed === 0 ? 'success' : 'warning',
      title: `${result.posted} posted${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
      description:
        result.failed > 0 ? 'A failed comment says why, and can be posted again.' : undefined,
    })
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="visible.length === 0" class="text-sm text-muted">
      No comments drafted yet. Ask a thread to <span class="font-medium">Draft comments</span> once
      it has reached a conclusion worth saying on the pull request.
    </p>

    <GuidedReviewDraftCard
      v-for="entry in visible"
      :key="entry.id"
      :session="session"
      :draft="entry"
      :pr-url="prUrl"
      :selected="!unticked.has(entry.id)"
      :busy="busy !== null"
      @update:selected="(on) => select(entry.id, on)"
      @edit="(input) => edit(entry.id, input)"
    />

    <div v-if="selected.length > 0" class="flex flex-col gap-2 border-t border-default pt-3">
      <UTextarea
        v-model="summary"
        :rows="2"
        autoresize
        placeholder="Optional summary comment, posted with them"
        class="w-full"
      />
      <div>
        <UButton
          icon="i-lucide-send"
          :loading="busy === 'post'"
          :disabled="busy !== null"
          @click="postSelected"
        >
          Post {{ selected.length }} {{ selected.length === 1 ? 'comment' : 'comments' }}
        </UButton>
      </div>
    </div>
  </div>
</template>
