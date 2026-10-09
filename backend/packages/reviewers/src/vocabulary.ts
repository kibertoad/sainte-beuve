import { normalizeSkill } from './selection.js'

export interface MergedVocabulary {
  /** The incoming entries in the vocabulary's spelling, without duplicates. */
  values: string[]
  /** The entries the vocabulary did not have, which the caller adds to it. */
  added: string[]
}

/**
 * Entries somebody picked, against the vocabulary they were picked from.
 *
 * Matched case-insensitively, and an entry the vocabulary already has takes the
 * vocabulary's spelling: `Billing` typed where `billing` is known is the same
 * domain, and storing both would split the reviewers who know it from the
 * repositories that need it.
 */
export function mergeVocabulary(
  known: readonly string[],
  incoming: readonly string[],
): MergedVocabulary {
  const spelling = new Map(known.map((entry) => [normalizeSkill(entry), entry]))
  const values: string[] = []
  const added: string[] = []
  for (const raw of incoming) {
    const entry = raw.trim()
    const key = normalizeSkill(entry)
    if (key === '') continue
    const existing = spelling.get(key)
    if (existing === undefined) {
      spelling.set(key, entry)
      added.push(entry)
      values.push(entry)
    } else if (!values.includes(existing)) {
      values.push(existing)
    }
  }
  return { values, added }
}
