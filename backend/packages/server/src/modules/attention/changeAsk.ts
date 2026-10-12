import type { AttentionRequest } from '@sainte-beuve/contracts'
import { assertFound } from '@sainte-beuve/kernel'
import type { AttentionPatch } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

/** The row a change left, and what `decide` answered on the run the store kept. */
export interface ChangedAsk {
  request: AttentionRequest
  patch: AttentionPatch | null
}

/**
 * Apply a decision to the ask as the store holds it, and answer with the row
 * the write left. The store reruns `decide` against the row another answer
 * left when one landed in between, so `decide` must read nothing but the ask
 * it is given and what the caller worked out before.
 */
export async function changeAsk(
  container: AppContainer,
  attentionId: string,
  decide: (stored: AttentionRequest) => AttentionPatch | null,
): Promise<ChangedAsk> {
  let patch: AttentionPatch | null = null
  const request = assertFound(
    await container.repositories.attention.change(attentionId, (stored) => {
      patch = decide(stored)
      return patch
    }),
    `No attention request ${attentionId}`,
  )
  return { request, patch }
}
