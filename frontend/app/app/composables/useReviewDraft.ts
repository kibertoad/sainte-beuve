import type { AiReviewFinding, AiReviewRun } from '@sainte-beuve/contracts'
import {
  type FindingPicks,
  initialDraft,
  reconcileDraft,
  type ReviewDraft,
  type ReviewOutcome,
} from '../utils/aiReviewPlan'

/**
 * How a curator means to settle one run, kept as a draft in this browser until
 * it is applied.
 *
 * Null until somebody changes anything, so findings that arrive while the
 * reviewer is still reporting start on their defaults instead of on a snapshot
 * taken before they existed. The draft is a convenience: a private window or
 * blocked storage loses it and the screen still works.
 */
export function useReviewDraft(run: () => AiReviewRun) {
  const storageKey = () => `sainte-beuve:ai-review-draft:${run().id}`
  const held = ref<ReviewDraft | null>(load(storageKey()))

  const draft = computed<ReviewDraft>(() => {
    const curation = run().curation
    if (curation === null) return { outcome: 'comment', picks: {} }
    return held.value === null
      ? initialDraft(curation)
      : reconcileDraft(curation.findings, held.value)
  })

  function store(next: ReviewDraft): void {
    held.value = next
    save(storageKey(), next)
  }

  function settleBy(outcome: ReviewOutcome): void {
    store({ ...draft.value, outcome })
  }

  function pick(findingId: string, picked: boolean): void {
    store({ ...draft.value, picks: { ...draft.value.picks, [findingId]: picked } })
  }

  /** Pick exactly the findings `matches` selects, the shortcut for a band of severities. */
  function pickWhere(matches: (finding: AiReviewFinding) => boolean): void {
    const picks: FindingPicks = {}
    for (const finding of run().curation?.findings ?? []) {
      picks[finding.findingId] = matches(finding)
    }
    store({ ...draft.value, picks })
  }

  /** Forget the draft, once it has been applied or somebody wants the defaults back. */
  function reset(): void {
    held.value = null
    remove(storageKey())
  }

  return { draft, settleBy, pick, pickWhere, reset, drafted: computed(() => held.value !== null) }
}

function load(key: string): ReviewDraft | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (!raw) return null
    return draftOf(JSON.parse(raw))
  } catch {
    return null
  }
}

function draftOf(parsed: unknown): ReviewDraft | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const { outcome, picks } = parsed as { outcome?: unknown; picks?: unknown }
  if (outcome !== 'comment' && outcome !== 'fix') return null
  if (typeof picks !== 'object' || picks === null) return null
  return {
    outcome,
    picks: Object.fromEntries(
      Object.entries(picks).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    ),
  }
}

function save(key: string, draft: ReviewDraft): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(draft))
  } catch {
    // A draft that cannot be kept is lost on reload, nothing worse.
  }
}

function remove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // Nothing to clean up when storage was never reachable.
  }
}
