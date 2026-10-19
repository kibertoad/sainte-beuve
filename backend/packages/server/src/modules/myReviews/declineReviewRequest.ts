import type {
  DeclinedReviewRequest,
  DeclineReviewRequest,
  Reviewer,
  ReviewDeclineNotice,
} from '@sainte-beuve/contracts'
import { handleOf, pendingRecipientIds } from '@sainte-beuve/contracts'
import { ConflictError, type ReviewDeclinedNotice, type VcsGateway } from '@sainte-beuve/kernel'
import { isSameHandle } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveChat, VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { AttentionService } from '../attention/AttentionService.js'
import { ViewerService } from '../identity/ViewerService.js'

/**
 * "Not me" on a row of My Reviews' "Asked to review".
 *
 * The host's request is taken back first, and a failure there is the caller's
 * failure: it is the half nobody else will undo, and the row would come back on
 * the next read. With no credential for the host there is no request to take
 * back, since none could have been listed. Only then are the teammate asks declined, through the same
 * call the inbox makes, so their requesters see it on the ask as they always do.
 * The author hears about the host half from here, since the host itself tells
 * nobody that a request was withdrawn.
 */
export async function declineReviewRequest(
  container: AppContainer,
  principal: RequestPrincipal,
  input: DeclineReviewRequest,
): Promise<DeclinedReviewRequest> {
  const resolutions = new VcsResolutions(container)
  const viewer = await new ViewerService(container, principal, resolutions).current()
  const handle = handleOf(viewer.reviewer.handles, input.pullRequest.provider)
  const gateway = handle === null ? null : await resolutions.acting(input.pullRequest.provider)
  const withdrawn =
    gateway !== null && handle !== null && (await withdraw(gateway.gateway, input, handle))
  const declinedAttentionIds = await declineAsks(container, viewer.reviewer, input)
  const authorNotice =
    withdrawn && gateway !== null
      ? await tellAuthor(container, gateway.gateway, viewer.reviewer, input)
      : 'none'
  return { withdrawnOnHost: withdrawn, declinedAttentionIds, authorNotice }
}

/** Whether the host was waiting on `handle` and has been told to stop. */
async function withdraw(
  gateway: VcsGateway,
  input: DeclineReviewRequest,
  handle: string,
): Promise<boolean> {
  const pending = await gateway.pendingReviewers(input.pullRequest)
  const login = pending.find((entry) => isSameHandle(entry, handle))
  if (login === undefined) return false
  await gateway.removeRequestedReviewers(input.pullRequest, [login])
  return true
}

/**
 * Every open ask on the pull request still waiting on the viewer. One that
 * closed, or that they answered in another tab, since it was listed is
 * skipped rather than refused: either way it no longer waits on them.
 */
async function declineAsks(
  container: AppContainer,
  viewer: Reviewer,
  input: DeclineReviewRequest,
): Promise<string[]> {
  const open = await container.repositories.attention.list({ status: ['open'] })
  const waiting = open.filter(
    (ask) =>
      ask.pullRequest.url === input.pullRequest.url && pendingRecipientIds(ask).includes(viewer.id),
  )
  const service = new AttentionService(container)
  const declined: string[] = []
  for (const ask of waiting) {
    try {
      await service.decline(viewer, ask.id, input.reason ?? null)
      declined.push(ask.id)
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err
    }
  }
  return declined
}

/**
 * Tell the author the host's request was refused: a DM when they are somebody
 * here with a Slack id, a comment on the pull request otherwise or when the DM
 * fails. Best effort, like every other notice: the refusal has already landed.
 */
async function tellAuthor(
  container: AppContainer,
  gateway: VcsGateway,
  viewer: Reviewer,
  input: DeclineReviewRequest,
): Promise<ReviewDeclineNotice> {
  const notice: ReviewDeclinedNotice = {
    pullRequest: input.pullRequest,
    title: input.title,
    declinedByName: viewer.displayName,
    reason: input.reason ?? null,
  }
  try {
    const { authorLogin } = await gateway.pullRequestStatus(input.pullRequest)
    if (await dmAuthor(container, notice, authorLogin)) return 'chat'
    await gateway.comment(input.pullRequest, declineComment(authorLogin, notice))
    return 'comment'
  } catch (err) {
    container.logger.warn(
      { err, pullRequest: input.pullRequest.url },
      'could not tell the author a review was declined',
    )
    return 'none'
  }
}

async function dmAuthor(
  container: AppContainer,
  notice: ReviewDeclinedNotice,
  authorLogin: string,
): Promise<boolean> {
  const provider = notice.pullRequest.provider
  const reviewers = await container.repositories.reviewers.list()
  const author = reviewers.find((reviewer) =>
    isSameHandle(handleOf(reviewer.handles, provider), authorLogin),
  )
  if (author?.slackUserId == null) return false
  const chat = await resolveChat(container)
  if (chat === null) return false
  try {
    await chat.gateway.sendReviewDeclined(notice, author.slackUserId)
    return true
  } catch (err) {
    container.logger.warn(
      { err, pullRequest: notice.pullRequest.url },
      'could not DM the author a declined review; commenting instead',
    )
    return false
  }
}

function declineComment(authorLogin: string, notice: ReviewDeclinedNotice): string {
  const line = `@${authorLogin}: ${notice.declinedByName} will not review this pull request.`
  return notice.reason === null ? line : `${line}\n\n> ${notice.reason.split('\n').join('\n> ')}`
}
