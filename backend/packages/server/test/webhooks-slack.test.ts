import { SLACK_ACTIONS } from '@sainte-beuve/integrations'
import type { AiReviewGateway } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addReviewer,
  buildHarness,
  form,
  openReview,
  recordingChat,
  recordingVcs,
  type TestHarness,
} from './helpers.js'

// The `/review` slash command and the announcement message's buttons, through
// the app: the signature gate, the intent, and what Slack renders back.

const SECRET = 'slack-signing-secret'
const PATH = '/webhooks/slack'

async function signed(
  harness: TestHarness,
  body: string,
  secret = SECRET,
): Promise<{ status: number; text: string }> {
  const timestamp = String(Math.floor(harness.clock.now() / 1000))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  )
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const res = await harness.app.fetch(
    form(PATH, body, {
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': `v0=${hex}`,
    }),
  )
  const body_ = (await res.json()) as { text?: string }
  return { status: res.status, text: body_.text ?? '' }
}

function command(text: string, userId = 'U-peer'): string {
  return new URLSearchParams({ command: '/review', text, user_id: userId }).toString()
}

function button(actionId: string, reviewId: string, userId = 'U-peer'): string {
  return new URLSearchParams({
    payload: JSON.stringify({
      user: { id: userId },
      actions: [{ action_id: actionId, value: reviewId }],
    }),
  }).toString()
}

describe('Slack interactivity', () => {
  let harness: TestHarness

  beforeEach(() => {
    // The clock is the harness's, and the signature carries its timestamp, so
    // the five-minute skew window is satisfied without freezing a real timer.
    harness = buildHarness({
      slack: { signingSecret: SECRET, announcementChannelId: 'C-reviews' },
    })
  })

  it('refuses a request this deployment cannot verify', async () => {
    const unconfigured = buildHarness()
    const res = await signed(unconfigured, command('list'))
    expect(res.status).toBe(503)
  })

  it('refuses a request signed with the wrong secret', async () => {
    expect((await signed(harness, command('list'), 'other')).status).toBe(403)
  })

  it('lists what is waiting', async () => {
    const review = await openReview(harness)
    const res = await signed(harness, command('list'))
    expect(res.status).toBe(200)
    expect(res.text).toContain(review.id)
    expect(res.text).toContain('(open)')
  })

  it('says so when nothing is waiting', async () => {
    expect((await signed(harness, command(''))).text).toContain('Nothing is waiting')
  })

  it('puts the person who asked on the review', async () => {
    await addReviewer(harness, {
      displayName: 'Peer',
      githubLogin: 'peer',
      slackUserId: 'U-peer',
    })
    const review = await openReview(harness)

    const res = await signed(harness, command(`take ${review.id}`))
    expect(res.text).toContain('is yours')
    const stored = await harness.container.repositories.reviews.getById(review.id)
    expect(stored).toMatchObject({ status: 'assigned' })
  })

  it('names the field to fill in when a Slack id maps to nobody', async () => {
    // Every fresh deployment is in this state, so it has to read as an
    // instruction rather than as a failure.
    const review = await openReview(harness)
    const res = await signed(harness, command(`take ${review.id}`))
    expect(res.text).toContain('U-peer')
    expect(res.text).toContain('reviewer pool')
  })

  it('treats a button press as the command it stands for', async () => {
    await addReviewer(harness, { displayName: 'Peer', slackUserId: 'U-peer' })
    const review = await openReview(harness)

    const res = await signed(harness, button(SLACK_ACTIONS.claim, review.id))
    expect(res.text).toContain('is yours')
  })

  it('hands a reroll to somebody other than whoever has it', async () => {
    await addReviewer(harness, { displayName: 'First', githubLogin: 'first' })
    await addReviewer(harness, { displayName: 'Second', githubLogin: 'second' })
    const review = await openReview(harness)
    await harness.app.fetch(
      new Request(`http://localhost/api/v1/reviews/${review.id}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      }),
    )

    const res = await signed(harness, button(SLACK_ACTIONS.reroll, review.id))
    expect(res.text).toContain('Second')
  })

  it('pushes the next nudge out rather than cancelling it', async () => {
    const review = await openReview(harness)
    const res = await signed(harness, command(`snooze ${review.id} 4`))
    expect(res.text).toContain('Snoozed')

    const outstanding = (
      await harness.container.repositories.reminders.listByReview(review.id)
    ).filter((reminder) => reminder.status === 'scheduled')
    // Still exactly one nudge outstanding, four hours out: a snooze defers the
    // chase, it does not end it.
    expect(outstanding).toHaveLength(1)
    expect(outstanding[0]?.dueAt).toBe(harness.clock.now() + 4 * 60 * 60 * 1000)
  })

  it('answers with the refusal rather than a status code', async () => {
    // Slack renders the reply and nothing else: a non-200 shows as "operation
    // timed out" and loses the message naming what is missing.
    const review = await openReview(harness)
    const res = await signed(harness, command(`ai ${review.id}`))
    expect(res.status).toBe(200)
    expect(res.text).toContain('cat-factory is not configured')
  })

  it('delegates to cat-factory when it is configured', async () => {
    const aiReview: AiReviewGateway = {
      requestReview: async () => ({ taskId: 'task-1', url: null }),
      getStatus: async () => ({ status: 'running', summary: null, failureReason: null }),
    }
    const wired = buildHarness({ aiReview, slack: harness.container.slack })
    const review = await openReview(wired)
    expect((await signed(wired, command(`ai ${review.id}`))).text).toContain('cat-factory')
  })

  it('names a review that is not on the board', async () => {
    expect((await signed(harness, command('take rev-nope'))).text).toContain('rev-nope')
  })

  it('offers help for something it cannot read', async () => {
    expect((await signed(harness, command('explode rev-1'))).text).toContain('/review take')
  })

  it('acks anything else Slack posts to the same URL', async () => {
    const res = await signed(harness, new URLSearchParams({ type: 'url_verification' }).toString())
    expect(res.status).toBe(200)
    expect(res.text).toBe('')
  })

  it('announces a new review in the channel the deployment named', async () => {
    const chat = recordingChat()
    const announcing = buildHarness({
      chat,
      vcs: recordingVcs(),
      slack: { signingSecret: SECRET, announcementChannelId: 'C-reviews' },
    })
    await openReview(announcing)
    expect(chat.posted).toStrictEqual([{ target: 'C-reviews', kind: 'announcement' }])
  })

  it('opens a review with no announcement when no channel is configured', async () => {
    const chat = recordingChat()
    const quiet = buildHarness({ chat })
    await openReview(quiet)
    // A deployment with no announcement channel is a supported deployment, so
    // this is silence rather than a failure.
    expect(chat.posted).toStrictEqual([])
  })
})
