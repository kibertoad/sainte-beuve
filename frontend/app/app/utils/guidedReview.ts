import type {
  GuidedReviewAnchor,
  GuidedReviewCommentDraft,
  GuidedReviewMessage,
  GuidedReviewFailureReason,
  GuidedReviewSession,
  GuidedReviewSessionView,
  GuidedReviewTarget,
  PullRequestRef,
} from '@sainte-beuve/contracts'
import { guidedReviewTargetQuerySchema, isWebUrl } from '@sainte-beuve/contracts'
import * as v from 'valibot'
import { ApiError, apiErrorMessage } from './sainteBeuveApi'

// The rules behind the guided-review screen, kept out of the components so a
// suite can pin them without mounting anything.

/** Where the guided review of a pull request lives. The PR's URL rides along for code links. */
export function guidedReviewRoute(pullRequest: PullRequestRef) {
  const { provider, owner, repo, number, url } = pullRequest
  return { path: '/guided-review', query: { provider, owner, repo, number: String(number), url } }
}

/** The pull request a route names, or null when its query does not name one. */
export function targetFromQuery(query: Record<string, unknown>): GuidedReviewTarget | null {
  const parsed = v.safeParse(guidedReviewTargetQuerySchema, query)
  return parsed.success ? parsed.output : null
}

/** The `url` a route carried, if it is one an anchor may link to. */
export function prUrlFromQuery(query: Record<string, unknown>): string | null {
  const url = query.url
  return typeof url === 'string' && isWebUrl(url) ? url : null
}

/**
 * Whether cat-factory is still producing something on this session, which is
 * what the screen polls for: the overview, or an answer some thread waits on.
 */
export function isSessionWorking(view: GuidedReviewSessionView): boolean {
  const { status } = view.session.overview
  if (status === 'pending' || status === 'running') return true
  return view.threads.some((thread) => thread.pendingMessageId !== null)
}

/** How often to re-read something a model answers in seconds. */
export const FAST_POLL_MS = 4000

/**
 * How often to re-read something that takes minutes. Every read of a session
 * here is two or three cat-factory calls, so a deep answer polled at the fast
 * cadence would spend a hundred of them to learn one thing.
 */
export const SLOW_POLL_MS = 15000

/**
 * The cadence for a session. Only its overview arrives in seconds; an answer a
 * thread waits on is polled by that thread, so the session read only has to
 * keep the other tabs' spinners honest.
 */
export function sessionPollInterval(view: GuidedReviewSessionView): number {
  const { status } = view.session.overview
  return status === 'pending' || status === 'running' ? FAST_POLL_MS : SLOW_POLL_MS
}

/** The cadence for a thread: slow while what it waits on is a deep answer, which takes minutes. */
export function threadPollInterval(messages: readonly GuidedReviewMessage[]): number {
  const deep = messages.some(
    (message) =>
      message.depth === 'deep' &&
      message.kind === 'answer' &&
      (message.status === 'pending' || message.status === 'running'),
  )
  return deep ? SLOW_POLL_MS : FAST_POLL_MS
}

const FAILURES: Record<GuidedReviewFailureReason, string> = {
  budget_exhausted: 'The model budget on the cat-factory side is spent.',
  model_unavailable: 'cat-factory could not reach a model.',
  repo_unavailable: 'cat-factory could not read the repository.',
  generation_failed: 'The model failed while answering.',
  unreadable_reply: 'The model answered with something cat-factory could not read.',
  depth_unavailable:
    'This cat-factory has no runner for answers from a checkout. Ask again without the switch.',
  head_moved: 'The pull request moved on while this was generated. Refresh to catch up.',
}

export function failureLabel(reason: GuidedReviewFailureReason): string {
  return FAILURES[reason]
}

/**
 * What to tell somebody whose request cat-factory refused, by cat-factory's own
 * name for the refusal. Null for one its message already explains.
 */
export function refusalHint(reason: string | undefined): string | null {
  switch (reason) {
    case 'repo_not_linked':
      return 'This repository is not linked to the cat-factory workspace. Link it there first.'
    case 'pr_not_found':
      return 'cat-factory could not find this pull request on its host.'
    case 'thread_busy':
      return 'This thread is still waiting on an answer.'
    case 'draft_conflict':
      return 'The draft changed since it was loaded. It has been reloaded; check it and try again.'
    case 'draft_anchor_outside_diff':
      return 'That line is not part of the diff, so the host would refuse a comment on it.'
    case 'session_stale':
      return 'The pull request has new commits. Re-read it at the latest commit and check the drafts before posting.'
    case 'not_session_owner':
      return 'This guided review belongs to another cat-factory identity, so it can be read but not changed.'
    default:
      return null
  }
}

/** What to tell somebody about a failed guided-review call: cat-factory's reason first. */
export function refusalMessage(err: unknown): string {
  const details = err instanceof ApiError ? (err.details as { reason?: unknown }) : undefined
  const reason = typeof details?.reason === 'string' ? details.reason : undefined
  return refusalHint(reason) ?? apiErrorMessage(err)
}

/** Whether a draft can still be posted: proposed, or a post that failed and may be retried. */
export function isPostable(draft: GuidedReviewCommentDraft): boolean {
  return draft.status === 'proposed' || draft.status === 'failed'
}

/** `src/poll.ts:40-52`, the way a reviewer names a span. */
export function anchorLabel(anchor: GuidedReviewAnchor): string {
  const { path, startLine, endLine } = anchor
  if (startLine === undefined) return path
  return endLine === undefined || endLine === startLine
    ? `${path}:${startLine}`
    : `${path}:${startLine}-${endLine}`
}

/**
 * A link to the span on the host, at the commit the review read.
 *
 * Built from the pull request's own URL, because a self-hosted host has no
 * address anything here could guess. A `LEFT` anchor is on the base branch.
 */
export function anchorHref(
  session: GuidedReviewSession,
  anchor: GuidedReviewAnchor,
  prUrl: string | null,
): string | null {
  if (prUrl === null) return null
  const origin = new URL(prUrl).origin
  const ref = anchor.side === 'LEFT' ? session.baseRef : session.reviewedHeadSha
  const blob = session.provider === 'gitlab' ? '-/blob' : 'blob'
  const path = anchor.path.split('/').map(encodeURIComponent).join('/')
  return `${origin}/${session.owner}/${session.repo}/${blob}/${encodeURIComponent(ref)}/${path}${lineFragment(session, anchor)}`
}

function lineFragment(session: GuidedReviewSession, anchor: GuidedReviewAnchor): string {
  const { startLine, endLine } = anchor
  if (startLine === undefined) return ''
  if (endLine === undefined || endLine === startLine) return `#L${startLine}`
  return session.provider === 'gitlab' ? `#L${startLine}-${endLine}` : `#L${startLine}-L${endLine}`
}
