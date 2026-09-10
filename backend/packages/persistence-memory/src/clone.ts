/**
 * The copy rule both halves of the in-memory store obey.
 *
 * Every read returns a COPY, and every patch is copied on the way IN as well as
 * out. A caller that mutates what it got back must not silently rewrite the
 * store, and a patch carrying an array held by reference would let one do
 * exactly that after the write returned. No durable adapter would behave that
 * way, so a suite passing against this one would fail against those.
 */

export function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Apply a patch to a stored row. The id is never patchable. */
export function patched<T extends { id: string }>(row: T, patch: Partial<T>): T {
  return clone({ ...row, ...patch, id: row.id })
}
