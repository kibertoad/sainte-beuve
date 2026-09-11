import type { CreateReviewer, Reviewer, UpdateReviewer, VcsProvider } from '@sainte-beuve/contracts'
import { NO_VCS_HANDLES, VCS_PROVIDERS, withHandle } from '@sainte-beuve/contracts'
import { blankToNull, parseSkills } from './text'

// The reviewer form's draft, and the conversions either side of it.
//
// Here rather than in the component because these are the parts worth a test. The
// handles map has to follow `VCS_PROVIDERS` rather than a hardcoded pair, and a save
// has to send what moved rather than the whole row. The component keeps the bindings
// and nothing else, which is what lets these run in Node with no Nuxt around them.

/**
 * The inputs, as text. Every nullable field is a string here and becomes a null on
 * the way out, because an empty box means "nothing recorded" rather than a person
 * whose team is the empty string.
 */
export interface ReviewerDraft {
  displayName: string
  handles: Record<VcsProvider, string>
  slackUserId: string
  team: string
  skills: string
  availability: Reviewer['availability']
  weight: number
}

/**
 * One box per host, keyed off `VCS_PROVIDERS`, which is also the list the inputs and
 * `toCreateReviewer` walk. A hardcoded pair beside two loops over that list is a
 * crash waiting for the day a third host is registered: the box nobody touched holds
 * `undefined`, and the submit trims it.
 */
function handlesOf(valueFor: (provider: VcsProvider) => string): Record<VcsProvider, string> {
  return Object.fromEntries(
    VCS_PROVIDERS.map((provider) => [provider, valueFor(provider)]),
  ) as Record<VcsProvider, string>
}

/** A FACTORY, not a shared constant: `v-model` writes straight into what it returns. */
export function emptyDraft(): ReviewerDraft {
  return {
    displayName: '',
    handles: handlesOf(() => ''),
    slackUserId: '',
    team: '',
    skills: '',
    availability: 'available',
    weight: 1,
  }
}

export function draftFrom(reviewer: Reviewer | null): ReviewerDraft {
  if (reviewer === null) return emptyDraft()
  return {
    displayName: reviewer.displayName,
    handles: handlesOf((provider) => reviewer.handles[provider] ?? ''),
    slackUserId: reviewer.slackUserId ?? '',
    team: reviewer.team ?? '',
    skills: reviewer.skills.join(', '),
    availability: reviewer.availability,
    weight: reviewer.weight,
  }
}

/** What the form says, as the body `createReviewer` takes. */
export function toCreateReviewer(draft: ReviewerDraft): CreateReviewer {
  return {
    displayName: draft.displayName.trim(),
    handles: VCS_PROVIDERS.reduce(
      (built, provider) => withHandle(built, provider, blankToNull(draft.handles[provider] ?? '')),
      NO_VCS_HANDLES,
    ),
    slackUserId: blankToNull(draft.slackUserId),
    team: blankToNull(draft.team),
    skills: parseSkills(draft.skills),
    availability: draft.availability,
    weight: draft.weight,
  }
}

/**
 * What the person editing actually changed, as the patch `updateReviewer` takes.
 *
 * `opened` is the row AS THE FORM OPENED IT, not the row as it stands now. That is
 * the whole point: a form that posts every field it holds reverts whatever somebody
 * else changed while it was open, so pausing a reviewer in a second tab and then
 * saving a form opened before that quietly resumes them. Diffing against the live
 * row would do the same, because the live row is the one the pause already changed.
 * Diffing against the snapshot sends the availability only if THIS form moved it.
 *
 * `updateReviewerSchema` is a partial, so a patch of the changed fields is what the
 * route wants anyway.
 */
export function reviewerPatch(opened: Reviewer, next: CreateReviewer): UpdateReviewer {
  const patch: UpdateReviewer = {}
  if (next.displayName !== opened.displayName) patch.displayName = next.displayName
  if (!sameHandles(opened, next)) patch.handles = next.handles
  if (next.slackUserId !== opened.slackUserId) patch.slackUserId = next.slackUserId
  if (next.team !== opened.team) patch.team = next.team
  if (!sameSkills(opened.skills, next.skills)) patch.skills = next.skills
  if (next.availability !== opened.availability) patch.availability = next.availability
  if (next.weight !== opened.weight) patch.weight = next.weight
  return patch
}

/** A patch naming `handles` replaces the whole map, so one changed box sends all of them. */
function sameHandles(opened: Reviewer, next: CreateReviewer): boolean {
  return VCS_PROVIDERS.every((provider) => opened.handles[provider] === next.handles[provider])
}

function sameSkills(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length && current.every((skill, index) => skill === next[index])
}
