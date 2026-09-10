<script setup lang="ts">
import type { OpenPullRequest } from '@sainte-beuve/contracts'
import { formatPullRequestRef } from '@sainte-beuve/contracts'

// One of the workspace's lists. The rows are identical whichever list they are
// in, and what differs is the action beside them, which is why the actions come
// in as a slot rather than as a prop the list has to branch on.
//
// The link goes OUT, to the host. sainte-beuve does not review a pull request:
// it decides who should and gets them there, and a diff rendered here would be
// a worse copy of the page the review actually happens on.
defineProps<{
  title: string
  description: string
  pullRequests: OpenPullRequest[]
  /** What to say when there is nothing, which is the state most people are in. */
  empty: string
}>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-baseline justify-between gap-4">
        <div class="min-w-0">
          <h2 class="font-medium">{{ title }}</h2>
          <p class="text-sm text-muted">{{ description }}</p>
        </div>
        <UBadge variant="subtle" color="neutral">{{ pullRequests.length }}</UBadge>
      </div>
    </template>

    <p v-if="pullRequests.length === 0" class="text-sm text-muted">{{ empty }}</p>

    <div v-else class="flex flex-col divide-y divide-default">
      <div
        v-for="pr in pullRequests"
        :key="pr.pullRequest.url"
        class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <ULink :to="pr.pullRequest.url" target="_blank" class="font-medium truncate">
              {{ pr.title }}
            </ULink>
            <UBadge v-if="pr.draft" size="sm" variant="subtle" color="neutral">draft</UBadge>
          </div>
          <p class="text-xs text-muted">
            {{ formatPullRequestRef(pr.pullRequest) }} &middot; {{ pr.authorLogin }}
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <slot name="actions" :pull-request="pr" />
          <UButton
            :to="pr.pullRequest.url"
            target="_blank"
            size="sm"
            variant="ghost"
            icon="i-lucide-external-link"
          >
            Review
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>
