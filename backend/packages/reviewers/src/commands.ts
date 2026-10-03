import type { Reviewer, ReviewRequest } from '@sainte-beuve/contracts'

/**
 * WHO MAY CHANGE A REVIEW FROM A CHAT COMMAND, decided over the person the chat
 * user maps to and the review they named.
 *
 * A Slack signature proves the request came from Slack, not who typed it: any
 * member of the workspace — a guest included, where the command is enabled —
 * can type `/review`. So every command that WRITES is asked for a directory row
 * first, the same row a sign-in would seat them on:
 *
 *  - NOBODY in the directory under that chat id changes nothing. Taking a review
 *    already needed the row; snoozing, rerolling and filing an AI review now do
 *    too, because the second spends the org's cat-factory budget and the first
 *    two move work off somebody else.
 *  - A PAUSED row is "not them, for now", here as at the sign-in.
 *  - A REROLL takes the review off whoever has it, so it is theirs to ask for —
 *    or an admin's, who decides who is in the pool at all. Anybody else asking
 *    is one person pulling a review off another.
 *
 * Reading the board (`/review` with no verb) is not asked about here: it writes
 * nothing, and it is the command a person new to the workspace types first.
 */
export type ChatCommandVerb = 'claim' | 'snooze' | 'reroll' | 'ai_review'

/** The fields of a directory row the decision reads. */
export type ChatActor = Pick<Reviewer, 'id' | 'role' | 'availability'>

export interface ChatCommandInput<A extends ChatActor = ChatActor> {
  verb: ChatCommandVerb
  /** The directory row the chat user maps to, or null when none does. */
  actor: A | null
  review: Pick<ReviewRequest, 'assignedReviewerIds'>
}

/** Allowed, and as whom; or refused, and why. */
export type ChatCommandDecision<A extends ChatActor = ChatActor> =
  | { allowed: true; actor: A }
  | { allowed: false; reason: 'not_in_directory' | 'paused' | 'not_the_holder' }

export function decideChatCommand<A extends ChatActor>(
  input: ChatCommandInput<A>,
): ChatCommandDecision<A> {
  const { actor, review, verb } = input
  if (actor === null) return { allowed: false, reason: 'not_in_directory' }
  if (actor.availability === 'paused') return { allowed: false, reason: 'paused' }
  if (verb !== 'reroll' || actor.role === 'admin') return { allowed: true, actor }
  return review.assignedReviewerIds.includes(actor.id)
    ? { allowed: true, actor }
    : { allowed: false, reason: 'not_the_holder' }
}
