<script setup lang="ts">
import type { GuidedReviewAnchor, GuidedReviewSession } from '@sainte-beuve/contracts'

// One span of code cat-factory pointed at, linked to the host at the commit the
// review read. Without the pull request's URL there is nowhere to link, and the
// span is still worth naming.
const props = defineProps<{
  session: GuidedReviewSession
  anchor: GuidedReviewAnchor
  prUrl: string | null
}>()

const href = computed(() => safeHref(anchorHref(props.session, props.anchor, props.prUrl)))
</script>

<template>
  <UBadge
    :as="href ? 'a' : 'span'"
    :href="href"
    target="_blank"
    variant="outline"
    color="neutral"
    size="sm"
    class="font-mono break-all"
    icon="i-lucide-file-code"
  >
    {{ anchorLabel(anchor) }}
  </UBadge>
</template>
