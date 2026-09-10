import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SNOOZE_HOURS,
  parseCommandText,
  parseSlackRequest,
  SLACK_ACTIONS,
} from './commands.js'

// The two shapes Slack posts, collapsed to one set of intents. Pure, so "what
// does `/review snooze rev-1 sixty` do?" is a test rather than a support ticket.

function command(text: string, userId = 'U123'): URLSearchParams {
  return new URLSearchParams({ command: '/review', text, user_id: userId })
}

function interaction(
  actionId: string,
  value: string,
  extra: Record<string, unknown> = {},
): URLSearchParams {
  return new URLSearchParams({
    payload: JSON.stringify({
      user: { id: 'U123' },
      actions: [{ action_id: actionId, value }],
      ...extra,
    }),
  })
}

describe('parseCommandText', () => {
  it('lists what is waiting when nobody named anything', () => {
    expect(parseCommandText('')).toStrictEqual({ kind: 'list' })
    expect(parseCommandText('  list ')).toStrictEqual({ kind: 'list' })
  })

  it('takes, rerolls and delegates a named review', () => {
    expect(parseCommandText('take rev-1')).toStrictEqual({ kind: 'claim', reviewId: 'rev-1' })
    expect(parseCommandText('reroll rev-1')).toStrictEqual({ kind: 'reroll', reviewId: 'rev-1' })
    expect(parseCommandText('ai rev-1')).toStrictEqual({ kind: 'ai_review', reviewId: 'rev-1' })
  })

  it('accepts the words somebody would actually type', () => {
    expect(parseCommandText('claim rev-1')).toMatchObject({ kind: 'claim' })
    expect(parseCommandText('REASSIGN rev-1')).toMatchObject({ kind: 'reroll' })
  })

  it('snoozes for a day unless a number says otherwise', () => {
    expect(parseCommandText('snooze rev-1')).toStrictEqual({
      kind: 'snooze',
      reviewId: 'rev-1',
      hours: DEFAULT_SNOOZE_HOURS,
    })
    expect(parseCommandText('snooze rev-1 4')).toMatchObject({ hours: 4 })
  })

  it('caps a snooze rather than silencing a review for a year', () => {
    expect(parseCommandText('snooze rev-1 100000')).toMatchObject({ hours: 24 * 14 })
    expect(parseCommandText('snooze rev-1 sixty')).toMatchObject({ hours: DEFAULT_SNOOZE_HOURS })
    expect(parseCommandText('snooze rev-1 0')).toMatchObject({ hours: DEFAULT_SNOOZE_HOURS })
  })

  it('answers with help rather than silence', () => {
    // A slash command that answers nothing looks broken in exactly the same way
    // as one that is broken.
    expect(parseCommandText('explode rev-1')).toStrictEqual({ kind: 'help' })
    expect(parseCommandText('take')).toStrictEqual({ kind: 'help' })
  })
})

describe('parseSlackRequest', () => {
  it('reads a slash command and who sent it', () => {
    expect(parseSlackRequest(command('take rev-1', 'U777'))).toStrictEqual({
      intent: { kind: 'claim', reviewId: 'rev-1' },
      userId: 'U777',
      surface: 'command',
      responseUrl: null,
    })
  })

  it('reads a button press as the command it stands for', () => {
    expect(parseSlackRequest(interaction(SLACK_ACTIONS.claim, 'rev-1'))).toStrictEqual({
      intent: { kind: 'claim', reviewId: 'rev-1' },
      userId: 'U123',
      surface: 'action',
      responseUrl: null,
    })
    expect(parseSlackRequest(interaction(SLACK_ACTIONS.snooze, 'rev-1'))).toMatchObject({
      intent: { kind: 'snooze', hours: DEFAULT_SNOOZE_HOURS },
    })
  })

  it('carries the surface and the URL an answer may go to', () => {
    // The two surfaces are answered in different places: a slash command in the
    // HTTP response, a button on its `response_url`, because Slack reads a
    // message in the response to a button as replacing the message it is on.
    const url = 'https://hooks.slack.com/actions/T1/1/abc'
    expect(
      parseSlackRequest(interaction(SLACK_ACTIONS.claim, 'rev-1', { response_url: url })),
    ).toMatchObject({ surface: 'action', responseUrl: url })
    expect(
      parseSlackRequest(
        new URLSearchParams({
          command: '/review',
          text: 'list',
          user_id: 'U123',
          response_url: url,
        }),
      ),
    ).toMatchObject({ surface: 'command', responseUrl: url })
  })

  it('ignores anything else Slack posts to the same URL', () => {
    // Slack sends its own URL verification and any event a workspace admin
    // subscribed to here; answering those with help text would be noise.
    expect(parseSlackRequest(new URLSearchParams({ type: 'url_verification' }))).toBeNull()
    expect(parseSlackRequest(new URLSearchParams({ payload: 'not json' }))).toBeNull()
    expect(parseSlackRequest(interaction('unknown_button', 'rev-1'))).toBeNull()
  })

  it('refuses a request with nobody behind it', () => {
    expect(parseSlackRequest(command('list', ''))).toBeNull()
    expect(parseSlackRequest(interaction(SLACK_ACTIONS.claim, ''))).toBeNull()
  })
})
