import type { Reminder, ReviewRequest } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { announcementMessage, escapeSlackText, reminderMessage, slackLink } from './message.js'

// What a review request READS like in Slack. Pure, so the wording, the buttons
// and the escaping are testable without a workspace.

const PR_URL = 'https://github.com/kibertoad/sainte-beuve/pull/7'

function review(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id: 'rev-1',
    pullRequest: {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 7,
      url: PR_URL,
    },
    title: 'Add a health check',
    authorLogin: 'author',
    requiredSkills: [],
    priority: 'normal',
    status: 'open',
    assignedReviewerIds: [],
    createdAt: 1,
    updatedAt: 1,
    assignedAt: null,
    dueAt: null,
    ...overrides,
  }
}

function reminder(kind: Reminder['kind']): Reminder {
  return {
    id: 'rem-1',
    reviewId: 'rev-1',
    kind,
    channel: 'slack_channel',
    reviewerId: null,
    dueAt: 2,
    snoozedUntil: null,
    status: 'scheduled',
    sentAt: null,
    failureReason: null,
    createdAt: 1,
  }
}

describe('announcementMessage', () => {
  it('links the pull request and carries the same text as the blocks', () => {
    const message = announcementMessage(review({ requiredSkills: ['payments'] }))
    expect(message.text).toBe(
      `Review wanted: <${PR_URL}|kibertoad/sainte-beuve#7> Add a health check (needs payments)`,
    )
    // `text` is what a notification preview and a screen reader use, so a
    // blocks-only message arrives on a phone as the word "message".
    expect(message.blocks?.[0]).toStrictEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: message.text },
    })
  })

  it('escapes a pull-request title rather than letting it write mrkdwn', () => {
    // Titles are typed by whoever opened the pull request, and this one is a
    // Slack link: unescaped, the announcement would carry a clickable link the
    // bot appears to vouch for, in a channel it was posted to by the bot.
    const crafted = announcementMessage(
      review({ title: '<https://evil.example|Approve here> & <!channel>' }),
    )
    expect(crafted.text).toContain(
      '&lt;https://evil.example|Approve here&gt; &amp; &lt;!channel&gt;',
    )
    // One link, the pull request's own.
    expect(crafted.text.match(/<[^|]+\|/g)).toHaveLength(1)
  })

  it('escapes the skills, which are labels somebody typed on the pull request', () => {
    const crafted = announcementMessage(review({ requiredSkills: ['<!here>'] }))
    expect(crafted.text).toContain('(needs &lt;!here&gt;)')
  })
})

describe('reminderMessage', () => {
  it('says what the nudge is for, and links back to the board when it can', () => {
    expect(reminderMessage(reminder('unassigned'), review(), undefined).text).toBe(
      `<${PR_URL}|kibertoad/sainte-beuve#7> is still waiting for a reviewer.`,
    )
    expect(reminderMessage(reminder('pending'), review(), 'https://board.example').text).toContain(
      'https://board.example/reviews/rev-1',
    )
    expect(reminderMessage(reminder('escalation'), review(), undefined).text).toContain(
      'past its review deadline',
    )
  })

  it('sends a parked AI review to the board, where its findings are', () => {
    const text = reminderMessage(
      reminder('ai_review_parked'),
      review(),
      'https://board.example',
    ).text
    expect(text).toContain('waiting on somebody to say which findings are worth posting')
    // The pull request is named, but the board is where the answer is: nothing
    // has been posted on the pull request yet, and nothing will be until
    // somebody curates.
    expect(text).toContain(`<${PR_URL}|kibertoad/sainte-beuve#7>`)
    expect(text).toContain('https://board.example/reviews/rev-1')
  })
})

describe('escapeSlackText', () => {
  it('escapes the three characters Slack reads as control', () => {
    expect(escapeSlackText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
    // The ampersand goes first, or the entities it writes get escaped again.
    expect(escapeSlackText('<')).toBe('&lt;')
  })
})

describe('slackLink', () => {
  it('keeps a crafted URL from ending the link early', () => {
    expect(slackLink('https://example.com/a>b|c', 'label')).toBe(
      '<https://example.com/a%3Eb%7Cc|label>',
    )
  })
})
