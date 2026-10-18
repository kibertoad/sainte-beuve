import type { AiReviewFinding, AiReviewRun } from '@sainte-beuve/contracts'
import {
  type FindingChoice,
  type FindingChoices,
  initialChoices,
  reconcileChoices,
} from '../utils/aiReviewPlan'

/**
 * What a curator has chosen for each finding of one run, kept as a draft in
 * this browser until it is applied.
 *
 * Null until somebody chooses anything, so findings that arrive while the
 * reviewer is still reporting start on their defaults instead of on a snapshot
 * taken before they existed. The draft is a convenience: a private window or
 * blocked storage loses it and the screen still works.
 */
export function useFindingChoices(run: () => AiReviewRun) {
  const storageKey = () => `sainte-beuve:ai-review-choices:${run().id}`
  const held = ref<FindingChoices | null>(load(storageKey()))

  const choices = computed<FindingChoices>(() => {
    const curation = run().curation
    if (curation === null) return {}
    return held.value === null
      ? initialChoices(curation)
      : reconcileChoices(curation.findings, held.value)
  })

  function store(next: FindingChoices): void {
    held.value = next
    save(storageKey(), next)
  }

  function choose(findingId: string, choice: FindingChoice): void {
    store({ ...choices.value, [findingId]: choice })
  }

  /** Set every finding `matches` picks to one choice, the shortcut for a whole severity. */
  function chooseWhere(
    matches: (finding: AiReviewFinding) => boolean,
    choice: FindingChoice,
  ): void {
    const next = { ...choices.value }
    for (const finding of run().curation?.findings ?? []) {
      if (matches(finding)) next[finding.findingId] = choice
    }
    store(next)
  }

  /** Forget the draft, once it has been applied or somebody wants the defaults back. */
  function reset(): void {
    held.value = null
    remove(storageKey())
  }

  return { choices, choose, chooseWhere, reset, drafted: computed(() => held.value !== null) }
}

const CHOICES = new Set<unknown>(['comment', 'fix', 'ignore'])

function load(key: string): FindingChoices | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, FindingChoice] =>
        CHOICES.has(entry[1]),
      ),
    )
  } catch {
    return null
  }
}

function save(key: string, choices: FindingChoices): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(choices))
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
