<script setup lang="ts">
import type { AttentionRequest } from '@sainte-beuve/contracts'
import { formatPullRequestRef } from '@sainte-beuve/contracts'

// The asks addressed to you, and the ones you raised.
//
// It sits at the top of the workspace because it is the only part of the screen
// where somebody else is waiting on an answer. Everything below it is work you
// can schedule; this is work somebody has asked you to schedule now.
const props = defineProps<{
  requests: AttentionRequest[]
  /** Who is looking, so an ask of theirs offers "withdraw" rather than "I will review it". */
  viewerId: string
  /** Whether the live half is attached. A false here is a slower inbox, not a broken one. */
  live: boolean
  busy: string | null
}>()

const emit = defineEmits<{ commit: [id: string]; cancel: [id: string] }>()

function outstanding(request: AttentionRequest): number {
  return Math.max(0, request.neededCommitments - request.commitments.length)
}

/** What the ask is still waiting for, said as a person would say it. */
function waitingFor(request: AttentionRequest): string {
  const left = outstanding(request)
  const committed = request.commitments.map((entry) => entry.displayName).join(', ')
  const taken = committed.length === 0 ? '' : ` (${committed} so far)`
  return left === 1 ? `one reviewer${taken}` : `${left} reviewers${taken}`
}

const mine = (request: AttentionRequest): boolean => request.requestedById === props.viewerId
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-baseline justify-between gap-3">
        <div>
          <h2 class="font-medium">Asking for attention</h2>
          <p class="text-sm text-muted">
            Pull requests your team has asked someone with your skills to pick up.
          </p>
        </div>
        <UBadge :color="live ? 'success' : 'neutral'" variant="subtle">
          {{ live ? 'live' : 'refresh to update' }}
        </UBadge>
      </div>
    </template>

    <p v-if="requests.length === 0" class="text-sm text-muted">
      Nobody is waiting on a reviewer. An ask disappears from here the moment enough people commit.
    </p>

    <div v-else class="flex flex-col divide-y divide-default">
      <div
        v-for="request in requests"
        :key="request.id"
        class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      >
        <div class="min-w-0">
          <ULink :to="request.pullRequest.url" target="_blank" class="font-medium line-clamp-2">
            {{ request.title }}
          </ULink>
          <p class="text-xs text-muted">
            {{ formatPullRequestRef(request.pullRequest) }} &middot; asked by
            {{ request.requestedByName }} &middot; waiting for {{ waitingFor(request) }}
          </p>
          <p v-if="request.note" class="text-sm mt-1">{{ request.note }}</p>
          <div class="flex flex-wrap gap-1 mt-2">
            <UBadge v-for="skill in request.requiredSkills" :key="skill" size="sm" variant="subtle">
              {{ skill }}
            </UBadge>
            <UBadge v-if="request.sameTeamOnly" size="sm" variant="subtle" color="neutral">
              {{ request.team ?? 'no team' }} only
            </UBadge>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 sm:shrink-0">
          <UButton
            v-if="mine(request)"
            size="sm"
            variant="ghost"
            color="neutral"
            :loading="busy === request.id"
            @click="emit('cancel', request.id)"
          >
            Withdraw
          </UButton>
          <UButton
            v-else
            size="sm"
            variant="soft"
            :loading="busy === request.id"
            @click="emit('commit', request.id)"
          >
            I will review it
          </UButton>
          <UButton
            :to="request.pullRequest.url"
            target="_blank"
            size="sm"
            variant="ghost"
            icon="i-lucide-external-link"
          >
            Open
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>
