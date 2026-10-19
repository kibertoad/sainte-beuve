import type { AttentionRequest } from '@sainte-beuve/contracts'
import type { AttentionAskNotice } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import {
  attentionAskMessage,
  attentionShortMessage,
  reviewDeclinedMessage,
} from './attentionMessage.js'
import { SLACK_ACTIONS } from './commands.js'

// The DM a named ask arrives as, in each state the ask passes through. A button
// is offered only while the ask is open and this person has not answered it.

const PR_URL = 'https://github.com/kibertoad/sainte-beuve/pull/7'
const LINK = `<${PR_URL}|kibertoad/sainte-beuve#7>`

function request(overrides: Partial<AttentionRequest> = {}): AttentionRequest {
  return {
    id: 'att-1',
    pullRequest: {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 7,
      url: PR_URL,
    },
    title: 'Add a health check',
    requestedById: 'rev-igor',
    requestedByName: 'Igor',
    recipients: [{ reviewerId: 'rev-ada', displayName: 'Ada' }],
    chatDeliveries: [],
    declines: [],
    keepAsking: false,
    people: null,
    requiredSkills: [],
    domains: [],
    sameTeamOnly: false,
    team: null,
    neededCommitments: 1,
    commitments: [],
    note: null,
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
    resolvedAt: null,
    ...overrides,
  }
}

function notice(overrides: Partial<AttentionAskNotice> = {}): AttentionAskNotice {
  return {
    request: request(),
    recipientId: 'rev-ada',
    matchedSkills: [],
    matchedDomains: [],
    ...overrides,
  }
}

function buttons(message: ReturnType<typeof attentionAskMessage>): unknown[] {
  return message.blocks?.find((block) => block.type === 'actions')?.elements ?? []
}

const ADA_COMMITTED = { reviewerId: 'rev-ada', displayName: 'Ada', committedAt: 2 }

describe('attentionAskMessage', () => {
  it('says who asks for what, with commit and decline buttons carrying the ask id', () => {
    const message = attentionAskMessage(notice(), undefined)
    expect(message.text).toBe(`Igor asks you to review ${LINK} Add a health check`)
    expect(buttons(message)).toStrictEqual([
      {
        type: 'button',
        text: { type: 'plain_text', text: 'I will review it' },
        action_id: SLACK_ACTIONS.attentionCommit,
        value: 'att-1',
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Not me' },
        action_id: SLACK_ACTIONS.attentionDecline,
        value: 'att-1',
      },
    ])
  })

  it('says why this person was asked, what the requester wrote, and how many are wanted', () => {
    const message = attentionAskMessage(
      notice({
        request: request({ note: 'Touches billing', neededCommitments: 2 }),
        matchedSkills: ['Backend'],
        matchedDomains: ['billing'],
      }),
      'https://reviews.example',
    )
    expect(message.blocks?.[1]?.text?.text).toBe(
      [
        '> Touches billing',
        'You match on skills Backend; domains billing.',
        '2 reviewers wanted.',
        '<https://reviews.example|Open your inbox>',
      ].join('\n'),
    )
  })

  it('escapes what the requester and the pull request author typed', () => {
    const message = attentionAskMessage(
      notice({ request: request({ title: '<!channel>', note: '<https://evil.example|x>' }) }),
      undefined,
    )
    expect(message.text).toContain('&lt;!channel&gt;')
    expect(message.blocks?.[1]?.text?.text).toBe('> &lt;https://evil.example|x&gt;')
  })

  it('quotes every line of a note that runs over several', () => {
    const message = attentionAskMessage(
      notice({ request: request({ note: 'Touches billing\nand the invoices' }) }),
      undefined,
    )
    expect(message.blocks?.[1]?.text?.text).toBe('> Touches billing\n> and the invoices')
  })

  it('drops the button once this person has committed and the ask is still open', () => {
    const message = attentionAskMessage(
      notice({ request: request({ neededCommitments: 2, commitments: [ADA_COMMITTED] }) }),
      undefined,
    )
    expect(message.text).toBe(`You said you will review ${LINK}. It is on your workspace.`)
    expect(buttons(message)).toStrictEqual([])
  })

  it('says this person passed once they declined, with no button', () => {
    const declines = [{ reviewerId: 'rev-ada', displayName: 'Ada', reason: null, declinedAt: 2 }]
    const message = attentionAskMessage(notice({ request: request({ declines }) }), undefined)
    expect(message.text).toBe(`You passed on reviewing ${LINK}.`)
    expect(buttons(message)).toStrictEqual([])
  })

  it('names who took a resolved ask, and thanks whoever was one of them', () => {
    const resolved = request({ status: 'resolved', commitments: [ADA_COMMITTED] })
    expect(attentionAskMessage(notice({ request: resolved }), undefined).text).toBe(
      `${LINK} has its reviewers: Ada. Thanks for taking it.`,
    )
    const other = attentionAskMessage(
      notice({ request: resolved, recipientId: 'rev-bo' }),
      undefined,
    )
    expect(other.text).toBe(`${LINK} has its reviewers: Ada.`)
    expect(buttons(other)).toStrictEqual([])
  })

  it('says a withdrawn ask was withdrawn, with no button', () => {
    const message = attentionAskMessage(
      notice({ request: request({ status: 'cancelled' }) }),
      undefined,
    )
    expect(message.text).toBe(`Igor withdrew the ask to review ${LINK}.`)
    expect(buttons(message)).toStrictEqual([])
  })
})

describe('attentionShortMessage', () => {
  const declines = [
    { reviewerId: 'rev-ada', displayName: 'Ada', reason: 'On <leave>', declinedAt: 2 },
    { reviewerId: 'rev-bo', displayName: 'Bo', reason: null, declinedAt: 3 },
  ]

  it('says who passed and why, and points at the inbox to ask on', () => {
    const message = attentionShortMessage(request({ declines }), 'https://sainte-beuve.example')
    expect(message.text).toBe(
      `Not enough of the people you asked to review ${LINK} are left to answer. ` +
        'Passed: Ada (On &lt;leave&gt;), Bo. ' +
        '<https://sainte-beuve.example|Ask the next best match> from your inbox.',
    )
    expect(buttons(message)).toStrictEqual([])
  })

  it('leaves the link out when the deployment has no address for the app', () => {
    expect(attentionShortMessage(request({ declines }), undefined).text).not.toContain('inbox')
  })
})

describe('reviewDeclinedMessage', () => {
  const declined = {
    pullRequest: request().pullRequest,
    title: 'Add a <health> check',
    declinedByName: 'Ada',
    reason: null,
  }

  it('says who will not review which pull request, with no button to press', () => {
    const message = reviewDeclinedMessage(declined)
    expect(message.text).toBe(`Ada will not review ${LINK} Add a &lt;health&gt; check.`)
    expect(buttons(message)).toStrictEqual([])
  })

  it('quotes the reason when one was given', () => {
    const message = reviewDeclinedMessage({ ...declined, reason: 'On leave\nuntil Monday' })
    expect(message.text).toContain('.\n> On leave\n> until Monday')
  })
})
