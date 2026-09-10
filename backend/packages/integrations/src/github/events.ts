import type { CreateReviewRequest, GitHubLabelRules, PullRequestRef } from '@sainte-beuve/contracts'

/**
 * What a GitHub delivery MEANS, decided as a pure function of the payload.
 *
 * The split is the same one the rest of the tree uses: this file reads a
 * third-party JSON blob and returns an intent, the service in
 * `@sainte-beuve/server` performs it. That is what makes the interesting half
 * testable against a fixture with no store, no token and no HTTP, and it is why
 * "a label with a typo in it does nothing" is a unit test rather than an
 * end-to-end one.
 *
 * The payload types below are deliberately partial. GitHub's event union is
 * enormous, we read five events out of it, and a full transcription would be a
 * copy of somebody else's spec that goes stale without failing.
 */

interface GitHubActor {
  login: string
}

interface GitHubLabel {
  name: string
}

interface GitHubRepositoryPayload {
  name: string
  owner: { login: string }
}

export interface GitHubPullRequestPayload {
  number: number
  title: string
  html_url: string
  draft?: boolean
  user?: GitHubActor | null
  labels?: GitHubLabel[]
}

/**
 * An issue. GitHub also presents a PULL REQUEST in this shape, on `issues` and
 * `issue_comment` events, marked by a non-null `pull_request` member. Both are
 * load-bearing here: a label added from the issues UI arrives as `issues`, and
 * every comment on a pull request arrives as `issue_comment`.
 */
export interface GitHubIssuePayload {
  number: number
  title: string
  html_url: string
  user?: GitHubActor | null
  labels?: GitHubLabel[]
  /** Present exactly when the issue IS a pull request. */
  pull_request?: { html_url?: string } | null
}

export interface GitHubEventPayload {
  action?: string
  repository?: GitHubRepositoryPayload
  pull_request?: GitHubPullRequestPayload
  issue?: GitHubIssuePayload
  review?: { state?: string; user?: GitHubActor | null }
  /** The label that was just added, on a `labeled` action. */
  label?: GitHubLabel
  comment?: { body?: string; user?: GitHubActor | null }
  sender?: GitHubActor
}

export interface GitHubDelivery {
  /** The `X-GitHub-Event` header. */
  event: string
  payload: GitHubEventPayload
}

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
 */
export type GitHubIntent =
  | { kind: 'track'; review: CreateReviewRequest; route: boolean }
  | { kind: 'close'; pullRequest: PullRequestRef }
  | { kind: 'resolve'; pullRequest: PullRequestRef; status: 'approved' | 'changes_requested' }
  | { kind: 'ai_review'; pullRequest: PullRequestRef }
  | { kind: 'command'; pullRequest: PullRequestRef; requester: string; verb: BotVerb }

export interface GitHubIntentContext {
  labels: GitHubLabelRules
  /**
   * The login the bot answers to when @-mentioned. Null (or blank) turns comment
   * commands off. Either form of a GitHub App's login is accepted:
   * `sainte-beuve` and `sainte-beuve[bot]` name the same bot, and which one a
   * deployment configured must not decide whether mentions work.
   */
  botLogin: string | null
}

/** The actions that mean "this pull request is ready to be looked at". */
const TRACKING_ACTIONS = new Set(['opened', 'reopened', 'ready_for_review'])

const VERBS: Record<string, BotVerb> = {
  review: 'review',
  assign: 'review',
  reroll: 'reroll',
  reassign: 'reroll',
  ai: 'ai',
  status: 'status',
}

/**
 * What this delivery asks for, or null when it asks for nothing. Null is the
 * common case and not a fault: GitHub sends every event the App subscribes to,
 * and most of them are not ours.
 */
export function interpretGitHubDelivery(
  delivery: GitHubDelivery,
  context: GitHubIntentContext,
): GitHubIntent | null {
  const { event, payload } = delivery
  if (event === 'pull_request') return fromPullRequest(payload, context)
  if (event === 'pull_request_review') return fromReview(payload)
  if (event === 'issues') return fromIssueLabel(payload, context)
  if (event === 'issue_comment') return fromComment(payload, context)
  return null
}

function fromPullRequest(
  payload: GitHubEventPayload,
  context: GitHubIntentContext,
): GitHubIntent | null {
  const pr = payload.pull_request
  const ref = pullRequestRef(payload, pr?.number, pr?.html_url)
  if (pr === undefined || ref === null) return null
  if (payload.action === 'closed') return { kind: 'close', pullRequest: ref }
  if (payload.action === 'labeled') {
    return fromLabel(ref, payload.label?.name, context, {
      title: pr.title,
      author: authorOf(pr),
      skills: skillsOf(pr.labels, context),
    })
  }
  // A draft is not a review request. It is skipped rather than tracked-and-ignored
  // because `ready_for_review` arrives when it stops being one, which is the event
  // that should open the row.
  if (!TRACKING_ACTIONS.has(payload.action ?? '') || pr.draft === true) return null
  return {
    kind: 'track',
    route: false,
    review: reviewRequest(ref, pr.title, authorOf(pr), skillsOf(pr.labels, context)),
  }
}

/**
 * A label added through the ISSUES UI on something that is a pull request. GitHub
 * delivers that as `issues`, not `pull_request`, so a team labelling from the
 * issues list would otherwise be met with silence. An issue that is not a pull
 * request is not a review request and is left alone.
 */
function fromIssueLabel(
  payload: GitHubEventPayload,
  context: GitHubIntentContext,
): GitHubIntent | null {
  const issue = payload.issue
  if (payload.action !== 'labeled' || issue?.pull_request == null) return null
  const ref = pullRequestRef(payload, issue.number, issue.pull_request.html_url ?? issue.html_url)
  if (ref === null) return null
  return fromLabel(ref, payload.label?.name, context, {
    title: issue.title,
    author: authorOf(issue),
    skills: skillsOf(issue.labels, context),
  })
}

/**
 * Which of the configured labels was added, and what it asks for. A label that
 * matches neither rule asks for nothing, which is most of them: teams label
 * pull requests all day for reasons that are none of our business.
 */
function fromLabel(
  ref: PullRequestRef,
  added: string | undefined,
  context: GitHubIntentContext,
  pr: { title: string; author: string; skills: string[] },
): GitHubIntent | null {
  if (added === undefined) return null
  if (added === context.labels.aiReview) return { kind: 'ai_review', pullRequest: ref }
  if (added !== context.labels.review) return null
  return { kind: 'track', route: true, review: reviewRequest(ref, pr.title, pr.author, pr.skills) }
}

function fromReview(payload: GitHubEventPayload): GitHubIntent | null {
  const pr = payload.pull_request
  const ref = pullRequestRef(payload, pr?.number, pr?.html_url)
  if (payload.action !== 'submitted' || ref === null) return null
  const state = payload.review?.state?.toLowerCase()
  // `commented` is a review too, and it deliberately resolves nothing: a comment
  // that stops the reminder clock is how a review goes quiet without an answer.
  if (state === 'approved') return { kind: 'resolve', pullRequest: ref, status: 'approved' }
  if (state === 'changes_requested') {
    return { kind: 'resolve', pullRequest: ref, status: 'changes_requested' }
  }
  return null
}

/**
 * A comment that @-mentions the bot. The mention has to be the way in rather than
 * a bare command word: `issue_comment` fires on every comment in every watched
 * repository, and a bot that acted on "reroll" appearing in prose would act on a
 * conversation about itself.
 */
function fromComment(
  payload: GitHubEventPayload,
  context: GitHubIntentContext,
): GitHubIntent | null {
  const issue = payload.issue
  const bot = botMentionLogin(context.botLogin)
  if (payload.action !== 'created' || issue?.pull_request == null || bot === null) return null
  const requester = commentAuthor(payload, bot)
  const verb = parseBotCommand(payload.comment?.body ?? '', bot)
  const ref = pullRequestRef(payload, issue.number, issue.pull_request.html_url ?? issue.html_url)
  if (requester === null || verb === null || ref === null) return null
  return { kind: 'command', pullRequest: ref, requester, verb }
}

/** GitHub's suffix on the login a GitHub App authors its comments under. */
const BOT_SUFFIX = '[bot]'

/**
 * The login as a PERSON types it, or null when this deployment answers no
 * mentions.
 *
 * A GitHub App has two logins for one identity: it comments as
 * `sainte-beuve[bot]` and is mentioned as `@sainte-beuve`. One configured value
 * has to serve both, so the suffix is stripped here and put back where the
 * author check needs it. Blank counts as unconfigured rather than as a login:
 * `@` on its own is not a mention of anybody, and an empty login would make the
 * bot answer every comment that contains one.
 */
export function botMentionLogin(configured: string | null): string | null {
  const trimmed = configured?.trim() ?? ''
  if (trimmed.length === 0) return null
  const bare = trimmed.toLowerCase().endsWith(BOT_SUFFIX)
    ? trimmed.slice(0, -BOT_SUFFIX.length)
    : trimmed
  return bare.length === 0 ? null : bare
}

/**
 * Who wrote the comment, when it is somebody we would answer. Null covers two
 * cases that both mean "not for us": a comment with no author, and the bot
 * ITSELF, because a deployment whose bot is also a reviewer would otherwise be
 * one comment away from a loop. Both forms of the bot's own login are caught,
 * since the comment carries the `[bot]` one whatever was configured.
 */
function commentAuthor(payload: GitHubEventPayload, bot: string): string | null {
  const requester = payload.comment?.user?.login
  if (requester === undefined) return null
  const lowered = requester.toLowerCase()
  const bare = bot.toLowerCase()
  return lowered === bare || lowered === `${bare}${BOT_SUFFIX}` ? null : requester
}

/**
 * The verb in `@bot <verb>`, or null. Exported because it is the piece a team
 * gets wrong most often (a mention with no verb, a verb before the mention), and
 * the answer to "why did nothing happen?" should be a test somebody can read.
 */
export function parseBotCommand(body: string, botLogin: string): BotVerb | null {
  const bare = botMentionLogin(botLogin)
  if (bare === null) return null
  // The boundary is a negative lookahead over the login alphabet rather than
  // `\b`, because a GitHub login may contain a hyphen: `\b` matches between the
  // `t` and the `-` of `@bot-staging`, so a bot called `bot` would answer for a
  // different account with a longer name.
  //
  // The `[bot]` suffix is CONSUMED rather than merely tolerated: somebody who
  // types `@sainte-beuve[bot] status` has named a verb, and a mention that
  // stopped before the suffix would read the verb as `[bot]` and fall through to
  // the bare-mention default.
  const mention = new RegExp(`@${escapeForRegExp(bare)}(?:\\[bot\\])?(?![a-z\\d-])`, 'i')
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

function authorOf(subject: { user?: GitHubActor | null }): string {
  return subject.user?.login ?? 'unknown'
}

function skillsOf(labels: GitHubLabel[] | undefined, context: GitHubIntentContext): string[] {
  const prefix = context.labels.skillPrefix
  if (prefix.length === 0) return []
  return (labels ?? [])
    .map((label) => label.name)
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length).trim())
    .filter((skill) => skill.length > 0)
}

function pullRequestRef(
  payload: GitHubEventPayload,
  number: number | undefined,
  url: string | undefined,
): PullRequestRef | null {
  const repository = payload.repository
  if (repository === undefined || number === undefined || url === undefined) return null
  return {
    provider: 'github',
    owner: repository.owner.login,
    repo: repository.name,
    number,
    url,
  }
}

function reviewRequest(
  pullRequest: PullRequestRef,
  title: string,
  authorLogin: string,
  requiredSkills: string[],
): CreateReviewRequest {
  return {
    pullRequest,
    title,
    authorLogin,
    requiredSkills,
    priority: 'normal',
    dueAt: null,
  }
}
