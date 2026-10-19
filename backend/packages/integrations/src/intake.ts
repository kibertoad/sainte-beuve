import type { CreateReviewRequest, PullRequestRef, ReviewLabelRules } from '@sainte-beuve/contracts'

/**
 * What a host's delivery asks of the board, whichever host sent it.
 *
 * Each host reads its own payload into these intents (`github/events.ts`,
 * `gitlab/events.ts`), and one service in `@sainte-beuve/server` performs them.
 * The label vocabulary and the bot's verbs live here rather than in either host's
 * file, so a team that labels a GitHub pull request and a GitLab merge request
 * the same way gets the same answer from both.
 */

/** What the bot can be asked to do in a pull-request comment. */
export type BotVerb = 'review' | 'reroll' | 'ai' | 'status'

/**
 * The actions a delivery can ask for.
 *
 * `track` carries `route` rather than being two intents, because opening a review
 * request and handing it to somebody are the same event seen from two triggers: a
 * pull request being opened tracks it and leaves it unassigned (which is the state
 * the reminder ladder exists to shorten), while the review LABEL is a team member
 * explicitly asking for a reviewer now.
 *
 * `ready` on `track` says the pull request just became a review request: it
 * opened as a non-draft, or left draft. That is what an org's automation runs
 * on (an assessment, an AI review), where a reopen or a label is not.
 *
 * `unapprove` is an approval taken back. Only GitLab says so as an event of its
 * own, and it puts a review the approval had settled back on the clock.
 *
 * `assess` is new commits on an open pull request: whatever it was assessed
 * as no longer describes it, so its assessment is redone if it has one.
 *
 * An author is null where the payload does not name one (a GitLab hook names
 * whoever acted, not the author), and the intake asks the host before it opens
 * a row with it.
 */
export type IntakeIntent =
  | { kind: 'track'; review: IntakeReview; route: boolean; ready: boolean }
  | { kind: 'close'; pullRequest: PullRequestRef }
  | { kind: 'resolve'; pullRequest: PullRequestRef; status: 'approved' | 'changes_requested' }
  | { kind: 'unapprove'; pullRequest: PullRequestRef }
  | { kind: 'assess'; pullRequest: PullRequestRef }
  | { kind: 'ai_review'; pullRequest: PullRequestRef; author: string | null }
  | {
      kind: 'command'
      pullRequest: PullRequestRef
      requester: string
      author: string | null
      verb: BotVerb
    }

/** The review request a delivery would open, with the author the payload named, if any. */
export type IntakeReview = Omit<CreateReviewRequest, 'authorLogin'> & {
  authorLogin: string | null
}

/** The pull request or merge request an intent is about. */
export function intentPullRequest(intent: IntakeIntent): PullRequestRef {
  return intent.kind === 'track' ? intent.review.pullRequest : intent.pullRequest
}

const VERBS: Record<string, BotVerb> = {
  review: 'review',
  assign: 'review',
  reroll: 'reroll',
  reassign: 'reroll',
  ai: 'ai',
  status: 'status',
}

/**
 * The verb in `@handle <verb>`, or null when the body does not mention `handle`
 * or names no verb this bot knows.
 *
 * The boundary is a negative lookahead over the handle alphabet rather than
 * `\b`, because a handle may contain a hyphen: `\b` matches between the `t` and
 * the `-` of `@bot-staging`, so a bot called `bot` would answer for a different
 * account with a longer name. A dot only continues a handle when something
 * follows it, since a GitLab handle may hold one and a sentence may end with one.
 *
 * `suffix` is CONSUMED rather than merely tolerated: somebody who types
 * `@sainte-beuve[bot] status` has named a verb, and a mention that stopped
 * before the suffix would read the verb as `[bot]`.
 */
export function parseMentionCommand(
  body: string,
  handle: string,
  suffix: string | null = null,
): BotVerb | null {
  const optionalSuffix = suffix === null ? '' : `(?:${escapeForRegExp(suffix)})?`
  const mention = new RegExp(
    `@${escapeForRegExp(handle)}${optionalSuffix}(?![a-z\\d_-]|\\.[a-z\\d_-])`,
    'i',
  )
  const match = mention.exec(body)
  if (match === null) return null
  const rest = body
    .slice(match.index + match[0].length)
    .trim()
    .toLowerCase()
  const word = /^[a-z]+/.exec(rest)?.[0]
  // A bare mention means the obvious thing. Somebody who types the bot's name and
  // nothing else wants a reviewer, not a usage message.
  if (word === undefined) return 'review'
  return VERBS[word] ?? null
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
}

/** The skills a set of label names asks for, by the configured prefix. */
export function skillsFromLabels(names: readonly string[], rules: ReviewLabelRules): string[] {
  const prefix = rules.skillPrefix
  if (prefix.length === 0) return []
  return names
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length).trim())
    .filter((skill) => skill.length > 0)
}

/**
 * Which of the configured labels was added, and what it asks for. A label that
 * matches neither rule asks for nothing, which is most of them: teams label
 * pull requests all day for reasons that are none of our business.
 */
export function labelIntent(
  ref: PullRequestRef,
  added: string | undefined,
  rules: ReviewLabelRules,
  pr: { title: string; author: string | null; skills: string[] },
): IntakeIntent | null {
  if (added === undefined) return null
  if (added === rules.aiReview) return { kind: 'ai_review', pullRequest: ref, author: pr.author }
  if (added !== rules.review) return null
  return {
    kind: 'track',
    route: true,
    ready: false,
    review: reviewRequest(ref, pr.title, pr.author, pr.skills),
  }
}

export function reviewRequest(
  pullRequest: PullRequestRef,
  title: string,
  authorLogin: string | null,
  requiredSkills: string[],
): IntakeReview {
  return {
    pullRequest,
    title,
    authorLogin,
    requiredSkills,
    priority: 'normal',
    dueAt: null,
  }
}
