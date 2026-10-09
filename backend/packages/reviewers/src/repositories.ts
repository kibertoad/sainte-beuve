import type { ProjectRef } from '@sainte-beuve/contracts'

/** Both hosts treat owner and repository names case-insensitively. */
export function repositoryKey(ref: ProjectRef): string {
  return `${ref.provider}:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`
}
