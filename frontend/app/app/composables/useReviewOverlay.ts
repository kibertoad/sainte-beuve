import type { PlacedCommitment, PullRequestRef } from '@sainte-beuve/contracts'
import { computed, ref, watch } from 'vue'

/** The id a commitment is drawn with until the read that holds the stored one. */
const UNSAVED_PREFIX = 'unsaved:'

/**
 * What this page changed about the review lists ahead of the read that will
 * report it: pull requests taken on or declined, and commitments handed back.
 *
 * Kept apart from the read and drawn over it, because a read can land with an
 * older answer: one that started before the call did, or a host search that
 * lags the request it was just told to withdraw. A declined pull request stays
 * hidden for the life of the page for that reason. A commitment drawn ahead of
 * its row is dropped once a read holds the stored one.
 */
export function useReviewOverlay(read: () => readonly PlacedCommitment[] | undefined) {
  const declined = ref(new Set<string>())
  const taken = ref(new Map<string, PlacedCommitment>())
  const released = ref(new Set<string>())

  watch(read, (rows) => {
    const stored = new Set((rows ?? []).map((row) => row.pullRequest.url))
    if (![...taken.value.keys()].some((url) => stored.has(url))) return
    taken.value = new Map([...taken.value].filter(([url]) => !stored.has(url)))
  })

  function decline(url: string): () => void {
    declined.value = new Set(declined.value).add(url)
    return () => {
      const next = new Set(declined.value)
      next.delete(url)
      declined.value = next
    }
  }

  function take(pullRequest: PullRequestRef, title: string, projectId: string | null): () => void {
    const row: PlacedCommitment = {
      id: `${UNSAVED_PREFIX}${pullRequest.url}`,
      reviewerId: '',
      pullRequest,
      title,
      attentionRequestId: null,
      requestedHandle: null,
      createdAt: Date.now(),
      projectId,
    }
    taken.value = new Map(taken.value).set(pullRequest.url, row)
    return () => {
      const next = new Map(taken.value)
      next.delete(pullRequest.url)
      taken.value = next
    }
  }

  function release(commitmentId: string): () => void {
    released.value = new Set(released.value).add(commitmentId)
    return () => {
      const next = new Set(released.value)
      next.delete(commitmentId)
      released.value = next
    }
  }

  /** The commitments as they will be: the ones being saved first, then the read's. */
  const committed = computed(() => {
    const stored = (read() ?? []).filter((row) => !released.value.has(row.id))
    const storedUrls = new Set(stored.map((row) => row.pullRequest.url))
    const unsaved = [...taken.value.values()].filter((row) => !storedUrls.has(row.pullRequest.url))
    return [...unsaved, ...stored]
  })

  /** Whether the viewer has not declined the pull request on this page. */
  function waiting(url: string): boolean {
    return !declined.value.has(url)
  }

  return { committed, waiting, decline, take, release }
}

/** Whether a commitment is still being saved, and so has nothing yet to hand back. */
export function isUnsaved(commitment: PlacedCommitment): boolean {
  return commitment.id.startsWith(UNSAVED_PREFIX)
}
