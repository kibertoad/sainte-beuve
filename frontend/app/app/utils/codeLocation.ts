/** Where in a pull request a finding points, as `path:line`, or the path alone for a file-level one. */
export function codeLocation(entry: { path: string; line: number | null }): string {
  return entry.line === null ? entry.path : `${entry.path}:${entry.line}`
}
