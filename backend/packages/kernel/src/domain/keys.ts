/**
 * The two keys a store is allowed to look a row up by, spelled once.
 *
 * They are domain rules rather than storage details, which is why they are here
 * and not in one of the adapters. Every store needs them (the in-memory one to
 * scan with, D1 and Postgres as an indexed column), and a copy per adapter is
 * how one of them comes to treat `Platform/API` as a second repository, or to
 * answer a GitLab merge request with the GitHub pull request of the same
 * number.
 */

/**
 * The unique key of a repository: `provider:owner/repo`, lowercased.
 *
 * Both hosts treat a repository path case-insensitively, so `Platform/API` and
 * `platform/api` are one project and must not be registered twice.
 */
export function projectRefKey(ref: { provider: string; owner: string; repo: string }): string {
  return `${ref.provider}:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`
}

/**
 * The unique key of a pull request: `provider:owner/repo#number`.
 *
 * The HOST is part of it, not decoration. `platform/api#12` exists on GitHub
 * and on GitLab and they are two different changes, so a lookup that matched on
 * the path alone would answer the second with the first and put the wrong
 * host's pull request on somebody's workspace.
 */
export function pullRequestKey(pr: {
  provider: string
  owner: string
  repo: string
  number: number
}): string {
  return `${projectRefKey(pr)}#${pr.number}`
}
