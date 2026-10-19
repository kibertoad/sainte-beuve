import type { PlacedCommitment } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { isUnsaved, useReviewOverlay } from '../app/composables/useReviewOverlay'

// What the review screens draw ahead of the read. The failures it exists for are
// a row that comes back after the viewer acted on it, and a commitment drawn
// twice once the stored one arrives.

function pr(number: number) {
  return {
    provider: 'github' as const,
    owner: 'acme',
    repo: 'api',
    number,
    url: `https://github.com/acme/api/pull/${number}`,
  }
}

function stored(number: number): PlacedCommitment {
  return {
    id: `c-${number}`,
    reviewerId: 'rev-ada',
    pullRequest: pr(number),
    title: `PR ${number}`,
    attentionRequestId: null,
    requestedHandle: null,
    createdAt: 1,
    projectId: null,
  }
}

describe('useReviewOverlay', () => {
  it('draws a commitment being saved first, and drops it once a read holds the stored one', async () => {
    const read = ref<PlacedCommitment[]>([stored(1)])
    const overlay = useReviewOverlay(() => read.value)

    overlay.take(pr(2), 'PR 2', null)
    expect(overlay.committed.value.map((row) => [row.pullRequest.number, isUnsaved(row)])).toEqual([
      [2, true],
      [1, false],
    ])

    read.value = [stored(2), stored(1)]
    await nextTick()
    expect(overlay.committed.value.map((row) => row.id)).toEqual(['c-2', 'c-1'])

    read.value = [stored(1)]
    await nextTick()
    expect(overlay.committed.value.map((row) => row.id)).toEqual(['c-1'])
  })

  it('keeps a declined pull request hidden whatever a lagging read says, until undone', () => {
    const overlay = useReviewOverlay(() => [])
    const undo = overlay.decline(pr(3).url)
    expect(overlay.waiting(pr(3).url)).toBe(false)
    undo()
    expect(overlay.waiting(pr(3).url)).toBe(true)
  })

  it('hides a handed-back commitment, and restores it when the call is refused', () => {
    const overlay = useReviewOverlay(() => [stored(1)])
    const undo = overlay.release('c-1')
    expect(overlay.committed.value).toEqual([])
    undo()
    expect(overlay.committed.value.map((row) => row.id)).toEqual(['c-1'])
  })
})
