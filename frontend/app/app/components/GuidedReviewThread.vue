<script setup lang="ts">
import type { GuidedReviewMessage, GuidedReviewSession } from '@sainte-beuve/contracts'
import { GUIDED_REVIEW_QUESTION_MAX } from '@sainte-beuve/contracts'

// One line of inquiry: the questions asked in it, cat-factory's answers, and
// the comment drafts it was asked to turn into. A thread holds one answer in
// flight, so the composer waits while one is pending; every other thread stays
// usable.
const props = defineProps<{
  session: GuidedReviewSession
  threadId: string
  /** The answer this thread waits on, from the session's stream. */
  pendingMessageId: string | null
  /** Whether the session is streaming. While it is, the thread re-reads on its word instead of polling. */
  live: boolean
  prUrl: string | null
}>()

/** Something moved that the session view carries too: a pending answer, or new drafts. */
const emit = defineEmits<{ changed: [] }>()

const api = useSainteBeuveApi()
const { data, error, refresh } = useAsyncData(
  `guided-review-thread-${props.threadId}`,
  () => api.getGuidedReviewThread(props.session.id, props.threadId),
  { lazy: true, watch: [() => props.threadId] },
)

const messages = computed<GuidedReviewMessage[]>(() => data.value?.messages ?? [])
const waiting = computed(() =>
  messages.value.some((message) => message.status === 'pending' || message.status === 'running'),
)

/**
 * Re-read the thread, and the session too when nothing is streaming it: a
 * settled answer can have added drafts, and a new question a pending one.
 */
async function reread(): Promise<void> {
  await refresh()
  if (!props.live) emit('changed')
}

// The stream reports when a pending answer starts or settles, and that is the
// moment to read the thread; the poll covers a page without the stream.
watch(
  () => props.pendingMessageId,
  () => refresh(),
)

usePolling(
  () => !props.live && waiting.value,
  async () => {
    await refresh()
    if (!waiting.value) emit('changed')
  },
  () => threadPollInterval(messages.value),
)

const question = ref('')
const deep = ref(false)
const { busy, run } = useApiAction({ refresh: reread, describe: refusalMessage })

async function ask(): Promise<void> {
  const content = question.value.trim()
  if (content.length === 0) return
  const asked = await run(
    () =>
      api.askGuidedReview(props.session.id, props.threadId, {
        content,
        depth: deep.value ? 'deep' : 'inline',
      }),
    'Could not ask the question',
    'ask',
  )
  if (asked) question.value = ''
}

async function draft(): Promise<void> {
  const drafted = await run(
    () => api.requestGuidedReviewDrafts(props.session.id, props.threadId, question.value.trim()),
    'Could not ask for comment drafts',
    'draft',
  )
  if (drafted) question.value = ''
}

function waitingLabel(message: GuidedReviewMessage): string {
  if (message.kind === 'comment-drafts') return 'Drafting review comments'
  return message.depth === 'deep'
    ? 'Investigating in a checkout of the repository. This takes a few minutes.'
    : 'Thinking'
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <ApiErrorAlert v-if="error" :error="error" title="Could not read this thread" />

    <div
      v-for="message in messages"
      :key="message.id"
      :class="[
        'flex flex-col gap-2 rounded-md p-3',
        message.role === 'user' ? 'bg-elevated' : 'border border-default',
      ]"
    >
      <p class="text-xs text-muted">
        {{ message.role === 'user' ? 'Asked' : 'cat-factory' }}
        <template v-if="message.role === 'user' && message.depth === 'deep'">
          &middot; deep dive</template
        >
      </p>

      <div
        v-if="message.status === 'pending' || message.status === 'running'"
        class="flex items-center gap-2 text-sm text-muted"
      >
        <UIcon name="i-lucide-loader-circle" class="animate-spin" />
        {{ waitingLabel(message) }}
      </div>
      <p v-else-if="message.status === 'failed' && message.failure" class="text-sm text-error">
        {{ failureLabel(message.failure.reason) }}
      </p>
      <p v-else class="text-sm whitespace-pre-line break-words">{{ message.content }}</p>

      <p v-if="message.draftReport" class="text-xs text-muted">
        {{ message.draftReport.proposed }} proposed
        <template v-if="message.draftReport.dropped.length > 0">
          &middot; {{ message.draftReport.dropped.length }} dropped because their line is not in the
          diff or the pull request
        </template>
      </p>

      <div v-if="message.citations.length > 0" class="flex flex-wrap gap-1">
        <GuidedReviewAnchorLink
          v-for="anchor in message.citations"
          :key="anchorLabel(anchor)"
          :session="session"
          :anchor="anchor"
          :pr-url="prUrl"
        />
      </div>
    </div>

    <form class="flex flex-col gap-2" @submit.prevent="ask">
      <UTextarea
        v-model="question"
        :rows="3"
        autoresize
        :maxlength="GUIDED_REVIEW_QUESTION_MAX"
        :disabled="waiting"
        placeholder="Ask a follow-up, or say which comments you want drafted"
        class="w-full"
      />
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <USwitch
          v-model="deep"
          label="Dig into a checkout"
          description="Takes minutes: searches the whole repository and can run read-only commands."
          :disabled="waiting"
        />
        <div class="flex flex-wrap gap-2">
          <UButton
            variant="ghost"
            icon="i-lucide-message-square-plus"
            :loading="busy === 'draft'"
            :disabled="waiting || busy !== null || messages.length === 0"
            @click="draft"
          >
            Draft comments
          </UButton>
          <UButton
            type="submit"
            icon="i-lucide-send"
            :loading="busy === 'ask'"
            :disabled="waiting || busy !== null || question.trim().length === 0"
          >
            Ask
          </UButton>
        </div>
      </div>
    </form>
  </div>
</template>
