// A rule the forms share, kept in one place so a change to how a blank box is
// treated is made once. `app/utils` is auto-imported, so there is no import to
// remember.

/** An empty box means "nothing recorded here", which is a null rather than a blank. */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
