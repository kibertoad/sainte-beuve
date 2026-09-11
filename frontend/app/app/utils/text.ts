// Two rules the forms share.
//
// Both were written out once per screen, so a change to how a blank box or a
// trailing comma is treated had to be found in four places. `app/utils` is
// auto-imported, so there is one copy and no import to remember.

/**
 * A comma-separated box as a list: entries trimmed, blanks and a trailing comma
 * dropped, because "typescript, payments," is what somebody mid-typing leaves behind.
 */
export function parseSkills(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** An empty box means "nothing recorded here", which is a null rather than a blank. */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
