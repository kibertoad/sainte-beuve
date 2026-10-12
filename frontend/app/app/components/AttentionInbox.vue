<script setup lang="ts">
import type { AttentionRequest } from '@sainte-beuve/contracts'
import {
  formatPullRequestRef,
  outstandingCommitments,
  recipientShortfall,
} from '@sainte-beuve/contracts'
import { declinedBy } from '../utils/attentionOrder'

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
  /**
   * Why the inbox could not be read, or null when it could.
   *
   * It has to be a prop rather than something the card infers, because the two
   * states it distinguishes look IDENTICAL from here: a failed read leaves the
   * list empty, and an empty list is also what "nobody is waiting" looks like.
   * The card rendered the second sentence over the first, which is the one
   * failure `ApiErrorAlert` was written to end and the one place it had not
   * reached.
   *
   * It does NOT imply an empty list. The live half sets one on a malformed
   * event with every request it has already read still on screen, so the error
   * is rendered beside the rows rather than in place of them.
   */
  error: string | null
  busy: string | null
}>()

const emit = defineEmits<{
  commit: [id: string]
  decline: [id: string, reason: string | null]
  askMore: [id: string]
  cancel: [id: string]
}>()

// An event that reached this page before it knew who is looking can still
// carry an ask the viewer declined, so the inbox leaves those out as well.
const visible = computed(() =>
  props.requests.filter((request) => !declinedBy(request, props.viewerId)),
)

/** What the ask is still waiting for, said as a person would say it. */
function waitingFor(request: AttentionRequest): string {
  const left = outstandingCommitments(request)
  const committed = request.commitments.map((entry) => entry.displayName).join(', ')
  const taken = committed.length === 0 ? '' : ` (${committed} so far)`
  return left === 1 ? `one reviewer${taken}` : `${left} reviewers${taken}`
}

function mine(request: AttentionRequest): boolean {
  return request.requestedById === props.viewerId
}

/** Who passed on the ask, with their reason when they gave one. */
function declinedLine(request: AttentionRequest): string {
  return request.declines
    .map((entry) =>
      entry.reason === null ? entry.displayName : `${entry.displayName} (${entry.reason})`,
    )
    .join(', ')
}

/** Whether a named ask can no longer fill from the people it names. */
function isShort(request: AttentionRequest): boolean {
  return recipientShortfall(request) > 0
}

/** Who an ask named, with the viewer said as "you". Empty for an ask sent by skill. */
function askedLine(request: AttentionRequest): string {
  return request.recipients
    .map((entry) => (entry.reviewerId === props.viewerId ? 'you' : entry.displayName))
    .join(', ')
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-baseline justify-between gap-3">
        <div>
          <h2 class="font-medium">Asking for attention</h2>
          <p class="text-sm text-muted">
            Pull requests somebody asked you, or anyone with your skills, to pick up.
          </p>
        </div>
        <UBadge v-if="error === null" :color="live ? 'success' : 'neutral'" variant="subtle">
          {{ live ? 'live' : 'refresh to update' }}
        </UBadge>
        <!-- Which failure it is: nothing at all, or rows that have stopped moving. -->
        <UBadge v-else color="error" variant="subtle">
          {{ requests.length === 0 ? 'unreadable' : 'out of date' }}
        </UBadge>
      </div>
    </template>

    <!--
      ABOVE the list rather than instead of it. The error is not always a failed
      READ: the live half sets one on a malformed event while the requests it
      has already rendered stay perfectly good, and blanking an actionable inbox
      over a bad frame hides more than it explains. What the error rules out is
      the reassurance below, not the rows.
    -->
    <UAlert
      v-if="error"
      class="mb-3"
      color="error"
      variant="subtle"
      title="This deployment could not read the asks"
      :description="error"
    />

    <p v-if="visible.length === 0 && error === null" class="text-sm text-muted">
      Nobody is waiting on a reviewer. An ask disappears from here the moment enough people commit.
    </p>

    <div v-if="visible.length > 0" class="flex flex-col divide-y divide-default">
      <div
        v-for="request in visible"
        :key="request.id"
        class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      >
        <div class="min-w-0">
          <ULink
            :to="safeHref(request.pullRequest.url)"
            target="_blank"
            class="font-medium line-clamp-2"
          >
            {{ request.title }}
          </ULink>
          <p class="text-xs text-muted">
            {{ formatPullRequestRef(request.pullRequest) }} &middot; asked by
            {{ request.requestedByName }} &middot; waiting for {{ waitingFor(request) }}
          </p>
          <p v-if="request.recipients.length > 0" class="text-xs text-muted">
            Asked: {{ askedLine(request) }}
          </p>
          <p v-if="mine(request) && request.declines.length > 0" class="text-xs text-muted">
            Declined: {{ declinedLine(request) }}
          </p>
          <p v-if="mine(request) && isShort(request)" class="text-xs text-warning">
            Not enough of the people you named are left to answer.
          </p>
          <p v-if="request.note" class="text-sm mt-1">{{ request.note }}</p>
          <div class="flex flex-wrap gap-1 mt-2">
            <UBadge v-for="skill in request.requiredSkills" :key="skill" size="sm" variant="subtle">
              {{ skill }}
            </UBadge>
            <UBadge
              v-for="domain in request.domains"
              :key="`domain:${domain}`"
              size="sm"
              variant="outline"
            >
              {{ domain }}
            </UBadge>
            <UBadge
              v-if="request.sameTeamOnly && request.recipients.length === 0"
              size="sm"
              variant="subtle"
              color="neutral"
            >
              {{ request.team ?? 'no team' }} only
            </UBadge>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 sm:shrink-0">
          <template v-if="mine(request)">
            <UButton
              v-if="isShort(request)"
              size="sm"
              variant="soft"
              :loading="busy === request.id"
              @click="emit('askMore', request.id)"
            >
              Ask the next best match
            </UButton>
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              :loading="busy === request.id"
              @click="emit('cancel', request.id)"
            >
              Withdraw
            </UButton>
          </template>
          <template v-else>
            <UButton
              size="sm"
              variant="soft"
              :loading="busy === request.id"
              @click="emit('commit', request.id)"
            >
              I will review it
            </UButton>
            <DeclineAskButton
              :loading="busy === request.id"
              @decline="(reason) => emit('decline', request.id, reason)"
            />
          </template>
          <UButton
            :to="safeHref(request.pullRequest.url)"
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
