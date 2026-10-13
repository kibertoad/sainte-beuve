import type { PullRequestRef, ReviewLabelRules } from '@sainte-beuve/contracts'
import {
  type IntakeIntent,
  labelIntent,
  parseMentionCommand,
  reviewRequest,
  skillsFromLabels,
} from '../intake.js'

/**
 * What a GitLab webhook delivery MEANS, decided as a pure function of the
 * payload, beside `github/events.ts` and producing the same intents.
 *
 * GitLab packs more into one delivery than GitHub does: a single `update` can
 * add two labels and take a merge request out of draft at once, so this answers
 * with a LIST of intents where GitHub's reader answers with one.
 *
 * The payload types are deliberately partial, for the reason the GitHub ones
 * are: two hooks out of a large union, read for a handful of fields.
 */

interface GitLabUser {
  username?: string
}

interface GitLabLabel {
  title: string
}

interface GitLabChange<T> {
  previous?: T
  current?: T
}

/** The `object_attributes` of a Merge Request Hook or a Note Hook. */
interface GitLabObjectAttributes {
  /** The merge request's number within its project, on a Merge Request Hook. */
  iid?: number
  title?: string
  url?: string
  action?: string
  /** The previous head, present on an `update` that pushed commits. */
  oldrev?: string
  draft?: boolean
  work_in_progress?: boolean
  /** A Note Hook's comment text. */
  note?: string
  /** What a note was left on: `MergeRequest`, `Issue`, `Commit` or `Snippet`. */
  noteable_type?: string
}

export interface GitLabEventPayload {
  /** `merge_request` or `note` for the two hooks read here. */
  object_kind?: string
  /** Who did the thing: opened, labelled, approved or commented. */
  user?: GitLabUser
  project?: { path_with_namespace?: string }
  object_attributes?: GitLabObjectAttributes
  /** The merge request's labels after this event, on a Merge Request Hook. */
  labels?: GitLabLabel[]
  changes?: {
    labels?: GitLabChange<GitLabLabel[]>
    draft?: GitLabChange<boolean>
    work_in_progress?: GitLabChange<boolean>
  }
  /** The merge request a note was left on, on a Note Hook. */
  merge_request?: { iid?: number; title?: string; url?: string }
}

export interface GitLabIntentContext {
  labels: ReviewLabelRules
  /**
   * The username the bot answers to when @-mentioned, which is the account of
   * the GitLab credential the replies are posted with. Null turns comment
   * commands off.
   */
  botUsername: string | null
}

/**
 * What this delivery asks for. Empty is the common case and not a fault: a
 * webhook subscribed to merge request and comment events hears about every one
 * of them, and most are not ours.
 */
export function interpretGitLabDelivery(
  payload: GitLabEventPayload,
  context: GitLabIntentContext,
): IntakeIntent[] {
  if (payload.object_kind === 'merge_request') return fromMergeRequest(payload, context)
  if (payload.object_kind === 'note') return fromNote(payload, context)
  return []
}

/** The actions that settle or re-open a merge request without reading anything else. */
const STATE_ACTIONS: Record<string, (ref: PullRequestRef) => IntakeIntent> = {
  close: (ref) => ({ kind: 'close', pullRequest: ref }),
  merge: (ref) => ({ kind: 'close', pullRequest: ref }),
  // `approved` and `unapproved` are GitLab saying the merge request as a whole
  // became, or stopped being, approved under its rules. The per-person
  // `approval` and `unapproval` actions settle nothing on their own, the way a
  // GitHub `commented` review does not.
  approved: (ref) => ({ kind: 'resolve', pullRequest: ref, status: 'approved' }),
  unapproved: (ref) => ({ kind: 'unapprove', pullRequest: ref }),
}

function fromMergeRequest(
  payload: GitLabEventPayload,
  context: GitLabIntentContext,
): IntakeIntent[] {
  const attributes = payload.object_attributes
  const ref = mergeRequestRef(payload, attributes?.iid, attributes?.url)
  if (attributes === undefined || ref === null) return []
  const action = attributes.action ?? ''
  const settle = STATE_ACTIONS[action]
  if (settle !== undefined) return [settle(ref)]
  if (action !== 'open' && action !== 'reopen' && action !== 'update') return []
  return fromActivity(payload, ref, action, context)
}

/** An open, reopen or update: becoming ready tracks, and each label it added may ask for something. */
function fromActivity(
  payload: GitLabEventPayload,
  ref: PullRequestRef,
  action: string,
  context: GitLabIntentContext,
): IntakeIntent[] {
  const subject = subjectOf(payload, action, context)
  const intents: IntakeIntent[] = []
  for (const added of addedLabels(payload, action)) {
    const intent = labelIntent(ref, added, context.labels, subject)
    if (intent !== null) intents.push(intent)
  }
  // The review label already tracks it, routed; an unrouted track first would only be undone.
  if (becameReady(payload, action) && !intents.some((i) => i.kind === 'track')) {
    intents.unshift(tracked(ref, subject, false))
  }
  if (action === 'update' && payload.object_attributes?.oldrev) {
    intents.push({ kind: 'assess', pullRequest: ref })
  }
  return intents
}

/**
 * Whether this event made the merge request ready for review. A draft is not a
 * review request, and leaving draft arrives as an `update`.
 */
function becameReady(payload: GitLabEventPayload, action: string): boolean {
  const attributes = payload.object_attributes
  if (attributes === undefined || isDraft(attributes)) return false
  return action === 'update' ? leftDraft(payload) : true
}

/** What a review request opened from this merge request would carry. */
interface Subject {
  title: string
  author: string | null
  skills: string[]
}

function subjectOf(
  payload: GitLabEventPayload,
  action: string,
  context: GitLabIntentContext,
): Subject {
  return {
    title: payload.object_attributes?.title ?? '',
    author: authorFor(payload, action),
    skills: skillsFromLabels(titles(payload.labels), context.labels),
  }
}

/**
 * A note that @-mentions the bot on a merge request.
 *
 * Whether the author is somebody to answer is NOT decided here. GitHub reports
 * how a commenter relates to the repository on the payload; GitLab reports
 * nothing of the kind, so the server answers only people its own reviewer
 * directory knows by this GitLab handle.
 */
function fromNote(payload: GitLabEventPayload, context: GitLabIntentContext): IntakeIntent[] {
  const bot = context.botUsername?.trim() ?? ''
  if (bot.length === 0 || !isNewMergeRequestNote(payload.object_attributes)) return []
  const requester = requesterOf(payload, bot)
  if (requester === null) return []
  const merge = payload.merge_request
  const ref = mergeRequestRef(payload, merge?.iid, merge?.url)
  const verb = parseMentionCommand(payload.object_attributes?.note ?? '', bot)
  if (ref === null || verb === null) return []
  // The Note Hook names the merge request's author only by id, so the intake
  // asks the host for it if this note opens the row.
  return [{ kind: 'command', pullRequest: ref, requester, author: null, verb }]
}

/** Who wrote the note, unless it was the bot itself, which never answers itself. */
function requesterOf(payload: GitLabEventPayload, bot: string): string | null {
  const requester = payload.user?.username
  if (requester === undefined || requester.toLowerCase() === bot.toLowerCase()) return null
  return requester
}

/**
 * A note just left on a merge request. Older GitLab sends no action on a note;
 * newer sends `create` or `update`, and an edited note is not asked again.
 */
function isNewMergeRequestNote(attributes: GitLabObjectAttributes | undefined): boolean {
  if (attributes?.noteable_type !== 'MergeRequest') return false
  return attributes.action === undefined || attributes.action === 'create'
}

function tracked(ref: PullRequestRef, subject: Subject, route: boolean): IntakeIntent {
  return {
    kind: 'track',
    route,
    review: reviewRequest(ref, subject.title, subject.author, subject.skills),
  }
}

function isDraft(attributes: GitLabObjectAttributes): boolean {
  return attributes.draft === true || attributes.work_in_progress === true
}

/** Whether this update took the merge request out of draft. GitLab has used both names. */
function leftDraft(payload: GitLabEventPayload): boolean {
  const { draft, work_in_progress: wip } = payload.changes ?? {}
  return (
    (draft?.previous === true && draft.current === false) ||
    (wip?.previous === true && wip.current === false)
  )
}

/**
 * The labels this event added. GitLab reports the labels a merge request was
 * created with only in `labels`, never as a change, so on `open` all of them
 * are new. An update adds the current set minus the previous one.
 */
function addedLabels(payload: GitLabEventPayload, action: string): string[] {
  if (action === 'open') return titles(payload.labels)
  const change = action === 'update' ? payload.changes?.labels : undefined
  if (change === undefined) return []
  const before = new Set(titles(change.previous))
  return titles(change.current).filter((title) => !before.has(title))
}

function titles(labels: GitLabLabel[] | undefined): string[] {
  return (labels ?? []).map((label) => label.title)
}

/**
 * The merge request's author, where the payload says. A Merge Request Hook
 * carries the AUTHOR only as a numeric id; its `user` is whoever acted, which is
 * the author exactly when the action is opening it.
 */
function authorFor(payload: GitLabEventPayload, action: string): string | null {
  return action === 'open' ? (payload.user?.username ?? null) : null
}

/**
 * The reference the GitLab gateway addresses: the last path segment is the
 * repo and the rest is the namespace, however deep it nests.
 */
function mergeRequestRef(
  payload: GitLabEventPayload,
  number: number | undefined,
  url: string | undefined,
): PullRequestRef | null {
  const path = payload.project?.path_with_namespace ?? ''
  const slash = path.lastIndexOf('/')
  if (number === undefined || url === undefined || slash <= 0 || slash === path.length - 1) {
    return null
  }
  return {
    provider: 'gitlab',
    owner: path.slice(0, slash),
    repo: path.slice(slash + 1),
    number,
    url,
  }
}
