import type { PublicResolvePrReview } from '@cat-factory/sdk'
import type { ResolveAiReview } from '@sainte-beuve/contracts'

/**
 * The body of a pr-review resolution. `fixFindingIds` is sent only when there
 * is something in it, so a plain post reads the same to an instance that
 * predates the field (the published SDK does too, hence the widened type).
 */
export function resolutionBodyOf(
  input: ResolveAiReview,
): PublicResolvePrReview & { fixFindingIds?: string[] } {
  return {
    action: input.action,
    findingIds: input.findingIds,
    ...(input.fixFindingIds.length > 0 ? { fixFindingIds: input.fixFindingIds } : {}),
  }
}
