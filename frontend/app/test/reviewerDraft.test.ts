import type { Reviewer } from '@sainte-beuve/contracts'
import { VCS_PROVIDERS } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { draftFrom, emptyDraft, reviewerPatch, toCreateReviewer } from '../app/utils/reviewerDraft'

/**
 * The reviewer form's two conversions, without a component around them.
 *
 * Both are here because both have already been a bug in a hand-written form: a
 * handles map that did not follow `VCS_PROVIDERS`, and a save that posted every
 * field it held over whatever somebody else had changed.
 */

const ada: Reviewer = {
  id: 'r-1',
  displayName: 'Ada',
  handles: { github: 'ada', gitlab: null },
  slackUserId: null,
  team: 'platform',
  skills: ['payments', 'typescript'],
  availability: 'available',
  weight: 1,
  outstandingReviews: 2,
  createdAt: 1_000,
}

describe('draftFrom', () => {
  it('keys the handles map off the provider list rather than a hardcoded pair', () => {
    expect(Object.keys(emptyDraft().handles)).toStrictEqual([...VCS_PROVIDERS])
    expect(Object.keys(draftFrom(ada).handles)).toStrictEqual([...VCS_PROVIDERS])
  })

  it('shows a missing handle as an empty box, not the string null', () => {
    expect(draftFrom(ada).handles.gitlab).toBe('')
  })

  it('opens the add form on the defaults a new reviewer gets', () => {
    const draft = emptyDraft()
    expect(draft.availability).toBe('available')
    expect(draft.weight).toBe(1)
    expect(draft.displayName).toBe('')
  })
})

describe('toCreateReviewer', () => {
  it('turns every empty box into a null', () => {
    const created = toCreateReviewer({ ...emptyDraft(), displayName: 'Grace' })
    expect(created.slackUserId).toBeNull()
    expect(created.team).toBeNull()
    expect(created.handles).toStrictEqual({ github: null, gitlab: null })
  })

  it('drops the blanks a half-typed skill list leaves behind', () => {
    const created = toCreateReviewer({ ...emptyDraft(), displayName: 'Grace', skills: 'go, , ' })
    expect(created.skills).toStrictEqual(['go'])
  })

  it('round-trips a row it did not change', () => {
    const created = toCreateReviewer(draftFrom(ada))
    expect(created.skills).toStrictEqual(ada.skills)
    expect(created.handles).toStrictEqual(ada.handles)
    expect(created.team).toBe(ada.team)
  })
})

describe('reviewerPatch', () => {
  it('sends nothing when nothing moved', () => {
    expect(reviewerPatch(ada, toCreateReviewer(draftFrom(ada)))).toStrictEqual({})
  })

  it('sends only the field that moved', () => {
    const draft = { ...draftFrom(ada), team: 'payments' }
    expect(reviewerPatch(ada, toCreateReviewer(draft))).toStrictEqual({ team: 'payments' })
  })

  // The case the whole-row patch got wrong. The form opened while Ada was available
  // and somebody paused her in a second tab. The save says only what it changed, so
  // the pause survives it; a patch carrying every field would resume her.
  it('leaves out an availability the form never touched', () => {
    const draft = { ...draftFrom(ada), skills: 'payments, typescript, go' }
    const patch = reviewerPatch(ada, toCreateReviewer(draft))
    expect(patch).toStrictEqual({ skills: ['payments', 'typescript', 'go'] })
    expect(patch.availability).toBeUndefined()
  })

  it('sends an availability the form did move', () => {
    const draft = { ...draftFrom(ada), availability: 'paused' as const }
    expect(reviewerPatch(ada, toCreateReviewer(draft))).toStrictEqual({ availability: 'paused' })
  })

  it('sends the whole handles map when one host changed, because a patch replaces it', () => {
    const draft = { ...draftFrom(ada), handles: { github: 'ada', gitlab: 'ada-l' } }
    expect(reviewerPatch(ada, toCreateReviewer(draft))).toStrictEqual({
      handles: { github: 'ada', gitlab: 'ada-l' },
    })
  })

  it('reports a cleared box as a null rather than as unchanged', () => {
    const draft = { ...draftFrom(ada), team: '   ' }
    expect(reviewerPatch(ada, toCreateReviewer(draft))).toStrictEqual({ team: null })
  })
})
