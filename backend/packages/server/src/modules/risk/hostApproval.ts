import type { ReviewRequest } from '@sainte-beuve/contracts'
import type { VcsGateway } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { type Approver, resolveApprover } from '../../integrations/riskResolve.js'

/**
 * Post as a comment what the host did not carry with the approval or its
 * withdrawal. Best effort: the approval itself has already landed or gone, and
 * a failed comment must not read as if it had not.
 */
async function remark(
  container: AppContainer,
  gateway: VcsGateway,
  review: ReviewRequest,
  body: string,
): Promise<void> {
  try {
    await gateway.comment(review.pullRequest, body)
  } catch (err) {
    container.logger.warn(
      { err, reviewId: review.id },
      'the note beside an automatic approval could not be posted',
    )
  }
}

/**
 * Approve at `headSha` as the approver, with `body` on the host one way or the
 * other. Throws what the host refused with, a `ConflictError` for a moved head.
 */
export async function approveOnHost(
  container: AppContainer,
  approver: Approver,
  review: ReviewRequest,
  input: { headSha: string; body: string },
): Promise<{ approvalId: string | null }> {
  const { approvalId, bodyPosted } = await approver.gateway.approve(review.pullRequest, input)
  if (!bodyPosted) await remark(container, approver.gateway, review, input.body)
  return { approvalId }
}

/**
 * Take back an automatic approval, saying why. A host that refuses is logged,
 * not thrown: whoever asked has their own row to settle either way.
 */
export async function withdrawOnHost(
  container: AppContainer,
  review: ReviewRequest,
  input: { approvalId: string | null; message: string },
): Promise<void> {
  const approver = await resolveApprover(container, review.pullRequest.provider)
  if (approver === null) {
    container.logger.warn(
      { reviewId: review.id },
      'an automatic approval could not be withdrawn: no approver is configured any more',
    )
    return
  }
  try {
    const { messagePosted } = await approver.gateway.withdrawApproval(review.pullRequest, input)
    if (!messagePosted) await remark(container, approver.gateway, review, input.message)
  } catch (err) {
    container.logger.warn(
      { err, reviewId: review.id },
      'an automatic approval could not be withdrawn',
    )
  }
}
