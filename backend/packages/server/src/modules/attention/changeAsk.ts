import type { AttentionRequest } from '@sainte-beuve/contracts'
import { assertFound } from '@sainte-beuve/kernel'
import type { AttentionPatch } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

/**
 * Apply a decision to the ask as the store holds it now, and answer with the
 * row the write left.
 *
 * The decision is read off a fresh row rather than the one the caller checked,
 * so the recommendation reads and the Slack calls an answer waits on do not
 * widen the gap a concurrent answer can fall into. The read and the write are
 * still two calls: two answers naming the same field in that gap can lose one.
 */
export async function changeAsk(
  container: AppContainer,
  attentionId: string,
  decide: (stored: AttentionRequest) => AttentionPatch,
): Promise<AttentionRequest> {
  const { attention } = container.repositories
  const stored = assertFound(
    await attention.getById(attentionId),
    `No attention request ${attentionId}`,
  )
  return assertFound(
    await attention.update(attentionId, decide(stored)),
    `No attention request ${attentionId}`,
  )
}
