<script setup lang="ts">
import type { GuidedReviewCommentDraft, GuidedReviewSession } from '@sainte-beuve/contracts'

// The review comments cat-factory drafted from the threads, each on the line it
// is about. Nothing here posts them: they are for the reviewer to carry onto
// the pull request, which is where the review happens.
const props = defineProps<{
  session: GuidedReviewSession
  drafts: GuidedReviewCommentDraft[]
  prUrl: string | null
}>()

type BadgeColor = 'info' | 'success' | 'error' | 'neutral' | 'warning'
const statusColor: Record<GuidedReviewCommentDraft['status'], BadgeColor> = {
  proposed: 'info',
  posting: 'warning',
  posted: 'success',
  failed: 'error',
  discarded: 'neutral',
}

const visible = computed(() => props.drafts.filter((entry) => entry.status !== 'discarded'))

function anchorOf(entry: GuidedReviewCommentDraft) {
  return {
    path: entry.path,
    startLine: entry.startLine ?? entry.line,
    endLine: entry.line,
    side: entry.side,
  }
}

const toast = useToast()

async function copy(entry: GuidedReviewCommentDraft): Promise<void> {
  try {
    await navigator.clipboard.writeText(entry.body)
    toast.add({ color: 'success', title: 'Comment copied' })
  } catch {
    toast.add({ color: 'error', title: 'Could not copy the comment' })
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="visible.length === 0" class="text-sm text-muted">
      No comments drafted yet. Ask a thread to <span class="font-medium">Draft comments</span> once
      it has reached a conclusion worth saying on the pull request.
    </p>
    <div
      v-for="entry in visible"
      :key="entry.id"
      class="flex flex-col gap-2 rounded-md border border-default p-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <GuidedReviewAnchorLink :session="session" :anchor="anchorOf(entry)" :pr-url="prUrl" />
        <UBadge :color="statusColor[entry.status]" variant="subtle" size="sm">
          {{ entry.status }}
        </UBadge>
      </div>
      <p class="text-sm whitespace-pre-line break-words">{{ entry.body }}</p>
      <p v-if="entry.rationale" class="text-xs text-muted whitespace-pre-line">
        {{ entry.rationale }}
      </p>
      <p v-if="entry.postError" class="text-xs text-error">{{ entry.postError }}</p>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" variant="ghost" icon="i-lucide-copy" @click="copy(entry)">
          Copy
        </UButton>
        <UButton
          v-if="safeHref(entry.postedUrl)"
          :to="safeHref(entry.postedUrl)"
          target="_blank"
          size="xs"
          variant="ghost"
          icon="i-lucide-external-link"
        >
          Posted comment
        </UButton>
      </div>
    </div>
  </div>
</template>
