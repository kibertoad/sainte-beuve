/**
 * What a Slack request ASKS for, decided as a pure function of the form body.
 *
 * Two inbound shapes arrive on one route, and both are form-encoded rather than
 * JSON, which is Slack's choice and not ours:
 *   - a SLASH COMMAND posts `command=/review&text=take rev-1&user_id=U123`;
 *   - a MESSAGE ACTION (a button on the announcement) posts a single
 *     `payload=<json>` field.
 *
 * They collapse to the same small set of intents, because a button exists to save
 * somebody typing the command it stands for. Keeping the collapse here, as data
 * in and data out, is what lets the service treat "took it from a button" and
 * "took it by typing" as one path.
 */

/** What somebody asked for, whichever surface they used. */
export type SlackIntent =
  | { kind: 'list' }
  | { kind: 'claim'; reviewId: string }
  | { kind: 'reroll'; reviewId: string }
  | { kind: 'snooze'; reviewId: string; hours: number }
  | { kind: 'ai_review'; reviewId: string }
  | { kind: 'help' }

export interface SlackRequest {
  intent: SlackIntent
  /** The Slack user id behind the request (`U…`), for resolving them to a reviewer. */
  userId: string
  /**
   * Which surface this arrived on, because it decides where the answer may go. A
   * slash command is answered in the HTTP response; a button press must NOT be,
   * since Slack reads a message there as a replacement for the message the
   * button is on.
   */
  surface: 'command' | 'action'
  /**
   * Slack's own URL for a follow-up message, when the payload carried one. It
   * needs no bot token, which is what lets a deployment with no Slack credential
   * still answer its own buttons.
   */
  responseUrl: string | null
}

/** The action ids the announcement message's buttons carry. */
export const SLACK_ACTIONS = {
  claim: 'review_claim',
  reroll: 'review_reroll',
  snooze: 'review_snooze',
} as const

/** How long a snooze pushes the next nudge out when nobody names a number. */
export const DEFAULT_SNOOZE_HOURS = 24
/** A cap, so a typo cannot silence a review for a year. */
const MAX_SNOOZE_HOURS = 24 * 14

/**
 * Read a decoded form body into a request, or null when it is neither shape we
 * serve. Null rather than a throw: Slack posts URL verification and unrelated
 * event callbacks to the same URL, and those are not errors.
 */
export function parseSlackRequest(form: URLSearchParams): SlackRequest | null {
  const interactive = form.get('payload')
  if (interactive !== null) return parseInteraction(interactive)
  const command = form.get('command')
  if (command === null) return null
  const userId = form.get('user_id') ?? ''
  if (userId.length === 0) return null
  return {
    intent: parseCommandText(form.get('text') ?? ''),
    userId,
    surface: 'command',
    responseUrl: form.get('response_url'),
  }
}

/**
 * The verbs that act on one named review, with the words somebody would actually
 * reach for. A table rather than a chain of comparisons, because the aliases are
 * the part that grows: `snooze` stays out of it because it takes an argument.
 */
const REVIEW_VERBS: Record<string, 'claim' | 'reroll' | 'ai_review'> = {
  take: 'claim',
  claim: 'claim',
  reroll: 'reroll',
  reassign: 'reroll',
  ai: 'ai_review',
}

/**
 * The words after `/review`. Free text typed by a person under time pressure, so
 * anything unrecognised becomes `help` rather than silence: a slash command that
 * answers nothing looks broken in exactly the same way as one that is broken.
 */
export function parseCommandText(text: string): SlackIntent {
  const [verb = '', reviewId = '', argument = ''] = text.trim().split(/\s+/)
  const lowered = verb.toLowerCase()
  if (lowered.length === 0 || lowered === 'list') return { kind: 'list' }
  // Every verb below names a review, so a missing id is a question rather than a
  // command, whichever verb it was.
  if (reviewId.length === 0) return { kind: 'help' }
  if (lowered === 'snooze') return { kind: 'snooze', reviewId, hours: snoozeHours(argument) }
  const kind = REVIEW_VERBS[lowered]
  return kind === undefined ? { kind: 'help' } : { kind, reviewId }
}

/** A whole number of hours inside the cap, or the default for anything else. */
function snoozeHours(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_SNOOZE_HOURS
  return Math.min(parsed, MAX_SNOOZE_HOURS)
}

interface InteractionAction {
  action_id?: string
  value?: string
}

interface InteractionPayload {
  user?: { id?: string }
  actions?: InteractionAction[]
  /** Where a follow-up goes. Slack puts it on every interaction payload. */
  response_url?: string
}

/**
 * A button press. The review id rides in the action's `value` rather than being
 * read back out of the message, because a message can be edited and its blocks
 * re-rendered, while the value is fixed when the button is created.
 */
function parseInteraction(raw: string): SlackRequest | null {
  const payload = readPayload(raw)
  if (payload === null) return null
  const userId = payload.user?.id ?? ''
  const intent = actionIntent(payload.actions?.[0])
  if (userId.length === 0 || intent === null) return null
  return { intent, userId, surface: 'action', responseUrl: payload.response_url ?? null }
}

/** What one button stands for, or null when its id or its value is not one we set. */
function actionIntent(action: InteractionAction | undefined): SlackIntent | null {
  const reviewId = action?.value ?? ''
  if (reviewId.length === 0) return null
  return intentForAction(action?.action_id ?? '', reviewId)
}

/** Null rather than a throw: Slack posts non-interaction bodies to the same URL. */
function readPayload(raw: string): InteractionPayload | null {
  try {
    return JSON.parse(raw) as InteractionPayload
  } catch {
    return null
  }
}

function intentForAction(actionId: string, reviewId: string): SlackIntent | null {
  if (actionId === SLACK_ACTIONS.claim) return { kind: 'claim', reviewId }
  if (actionId === SLACK_ACTIONS.reroll) return { kind: 'reroll', reviewId }
  if (actionId === SLACK_ACTIONS.snooze) {
    return { kind: 'snooze', reviewId, hours: DEFAULT_SNOOZE_HOURS }
  }
  return null
}
