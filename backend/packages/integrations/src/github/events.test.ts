import type { GitHubLabelRules } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  type GitHubEventPayload,
  type GitHubIntentContext,
  interpretGitHubDelivery,
  parseBotCommand,
} from './events.js'

// What a delivery MEANS, against fixtures. This is where "a label with a typo in
// it does nothing" is a unit test rather than a thing somebody finds out in a
// repository, and it needs no store, no token and no HTTP.

const LABELS: GitHubLabelRules = {
  review: 'needs-review',
  aiReview: 'ai-review',
  skillPrefix: 'skill:',
}

const CONTEXT: GitHubIntentContext = { labels: LABELS, botLogin: 'sainte-beuve-bot' }

const REPOSITORY = { name: 'sainte-beuve', owner: { login: 'kibertoad' } }
const PR_URL = 'https://github.com/kibertoad/sainte-beuve/pull/42'

function pullRequest(overrides: Partial<GitHubEventPayload> = {}): GitHubEventPayload {
  return {
    action: 'opened',
    repository: REPOSITORY,
    pull_request: {
      number: 42,
      title: 'Add a health check',
      html_url: PR_URL,
      draft: false,
      user: { login: 'kibertoad' },
      labels: [],
    },
    ...overrides,
  }
}

/** An `issues` or `issue_comment` payload, which is how GitHub presents a PR outside `pull_request`. */
function issue(overrides: Partial<GitHubEventPayload> = {}): GitHubEventPayload {
  return {
    repository: REPOSITORY,
    issue: {
      number: 42,
      title: 'Add a health check',
      html_url: 'https://github.com/kibertoad/sainte-beuve/issues/42',
      user: { login: 'kibertoad' },
      labels: [],
      pull_request: { html_url: PR_URL },
    },
    ...overrides,
  }
}

const REF = {
  provider: 'github',
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 42,
  url: PR_URL,
}

describe('interpretGitHubDelivery: pull requests', () => {
  it('tracks an opened pull request without handing it to anybody', () => {
    const intent = interpretGitHubDelivery(
      { event: 'pull_request', payload: pullRequest() },
      CONTEXT,
    )
    // Tracked and unassigned on purpose: opening a pull request is not the same
    // gesture as asking for a reviewer, and `open` is the state the reminder
    // ladder exists to shorten.
    expect(intent).toMatchObject({ kind: 'track', route: false })
    expect(intent).toMatchObject({ review: { pullRequest: REF, authorLogin: 'kibertoad' } })
  })

  it('waits for a draft to be marked ready', () => {
    const draft = pullRequest({
      pull_request: { ...pullRequest().pull_request!, draft: true },
    })
    expect(interpretGitHubDelivery({ event: 'pull_request', payload: draft }, CONTEXT)).toBeNull()

    const ready = pullRequest({ action: 'ready_for_review' })
    expect(
      interpretGitHubDelivery({ event: 'pull_request', payload: ready }, CONTEXT),
    ).toMatchObject({ kind: 'track' })
  })

  it('closes a review when the pull request closes', () => {
    const closed = pullRequest({ action: 'closed' })
    expect(
      interpretGitHubDelivery({ event: 'pull_request', payload: closed }, CONTEXT),
    ).toStrictEqual({ kind: 'close', pullRequest: REF })
  })

  it('marks the author unknown rather than dropping a PR from a deleted account', () => {
    const orphan = pullRequest({ pull_request: { ...pullRequest().pull_request!, user: null } })
    expect(
      interpretGitHubDelivery({ event: 'pull_request', payload: orphan }, CONTEXT),
    ).toMatchObject({ review: { authorLogin: 'unknown' } })
  })

  it('ignores an event about something with no repository on it', () => {
    const orphan = pullRequest({ repository: undefined })
    expect(interpretGitHubDelivery({ event: 'pull_request', payload: orphan }, CONTEXT)).toBeNull()
  })
})

describe('interpretGitHubDelivery: labels', () => {
  it('routes the review when the review label lands', () => {
    const labeled = pullRequest({ action: 'labeled', label: { name: 'needs-review' } })
    expect(
      interpretGitHubDelivery({ event: 'pull_request', payload: labeled }, CONTEXT),
    ).toMatchObject({ kind: 'track', route: true })
  })

  it('delegates to cat-factory when the AI-review label lands', () => {
    const labeled = pullRequest({ action: 'labeled', label: { name: 'ai-review' } })
    expect(
      interpretGitHubDelivery({ event: 'pull_request', payload: labeled }, CONTEXT),
    ).toStrictEqual({ kind: 'ai_review', pullRequest: REF })
  })

  it('does nothing for a label that matches no rule', () => {
    const labeled = pullRequest({ action: 'labeled', label: { name: 'needs-reviews' } })
    // Teams label pull requests all day for reasons that are none of our
    // business, and a near-miss must not be treated as a hit.
    expect(interpretGitHubDelivery({ event: 'pull_request', payload: labeled }, CONTEXT)).toBeNull()
  })

  it('reads the required skills off the prefixed labels', () => {
    const labeled = pullRequest({
      action: 'labeled',
      label: { name: 'needs-review' },
      pull_request: {
        ...pullRequest().pull_request!,
        labels: [{ name: 'skill:payments' }, { name: 'skill: typescript ' }, { name: 'bug' }],
      },
    })
    expect(
      interpretGitHubDelivery({ event: 'pull_request', payload: labeled }, CONTEXT),
    ).toMatchObject({ review: { requiredSkills: ['payments', 'typescript'] } })
  })

  it('accepts a label added through the issues UI on a pull request', () => {
    // GitHub delivers that as `issues`, not `pull_request`: a team labelling from
    // the issues list would otherwise be met with silence.
    const labeled = issue({ action: 'labeled', label: { name: 'needs-review' } })
    const intent = interpretGitHubDelivery({ event: 'issues', payload: labeled }, CONTEXT)
    expect(intent).toMatchObject({ kind: 'track', route: true })
    // The pull request's own URL, not the issue's, because that is what the board links to.
    expect(intent).toMatchObject({ review: { pullRequest: REF } })
  })

  it('leaves a label on a plain issue alone', () => {
    const plain = issue({ action: 'labeled', label: { name: 'needs-review' } })
    plain.issue = { ...plain.issue!, pull_request: null }
    expect(interpretGitHubDelivery({ event: 'issues', payload: plain }, CONTEXT)).toBeNull()
  })
})

describe('interpretGitHubDelivery: reviews', () => {
  it('resolves a review on an approval and on a change request', () => {
    const submitted = (state: string) => ({
      event: 'pull_request_review',
      payload: pullRequest({ action: 'submitted', review: { state } }),
    })
    expect(interpretGitHubDelivery(submitted('approved'), CONTEXT)).toStrictEqual({
      kind: 'resolve',
      pullRequest: REF,
      status: 'approved',
    })
    expect(interpretGitHubDelivery(submitted('changes_requested'), CONTEXT)).toMatchObject({
      status: 'changes_requested',
    })
  })

  it('leaves a commented review outstanding', () => {
    // A comment that stopped the reminder clock is how a review goes quiet
    // without ever having produced an answer.
    const commented = pullRequest({ action: 'submitted', review: { state: 'commented' } })
    expect(
      interpretGitHubDelivery({ event: 'pull_request_review', payload: commented }, CONTEXT),
    ).toBeNull()
  })
})

describe('interpretGitHubDelivery: bot mentions', () => {
  const comment = (body: string, login = 'reviewer') =>
    interpretGitHubDelivery(
      {
        event: 'issue_comment',
        payload: issue({ action: 'created', comment: { body, user: { login } } }),
      },
      CONTEXT,
    )

  it('takes a verb after the mention', () => {
    expect(comment('@sainte-beuve-bot reroll please')).toStrictEqual({
      kind: 'command',
      pullRequest: REF,
      requester: 'reviewer',
      verb: 'reroll',
    })
  })

  it('reads a bare mention as asking for a reviewer', () => {
    expect(comment('cc @sainte-beuve-bot')).toMatchObject({ verb: 'review' })
  })

  it('ignores a comment that does not mention the bot', () => {
    // `issue_comment` fires on every comment in every watched repository, so a
    // bot that acted on a bare verb would act on a conversation about itself.
    expect(comment('reroll this one')).toBeNull()
  })

  it('never answers itself', () => {
    expect(comment('@sainte-beuve-bot review', 'sainte-beuve-bot')).toBeNull()
  })

  it('stays quiet when no bot login is configured', () => {
    expect(
      interpretGitHubDelivery(
        {
          event: 'issue_comment',
          payload: issue({
            action: 'created',
            comment: { body: '@sainte-beuve-bot review', user: { login: 'reviewer' } },
          }),
        },
        { labels: LABELS, botLogin: null },
      ),
    ).toBeNull()
  })

  it('reads a blank bot login as no bot at all', () => {
    // A deployment that ships `GITHUB_BOT_LOGIN=` and never fills it in: an
    // empty login makes `@` on its own a mention of nobody, so the bot would
    // answer a conversation it was never named in.
    const blank = (body: string) =>
      interpretGitHubDelivery(
        {
          event: 'issue_comment',
          payload: issue({ action: 'created', comment: { body, user: { login: 'reviewer' } } }),
        },
        { labels: LABELS, botLogin: '' },
      )
    expect(blank('who owns this @')).toBeNull()
    expect(blank('cc @ review')).toBeNull()
  })

  it('answers a GitHub App under either of its two logins', () => {
    // An App comments as `sainte-beuve-bot[bot]` and is mentioned as
    // `@sainte-beuve-bot`, so whichever form a deployment configured has to
    // work for both the mention and the never-answer-itself check.
    const suffixed: GitHubIntentContext = { labels: LABELS, botLogin: 'sainte-beuve-bot[bot]' }
    const from = (login: string, context: GitHubIntentContext) =>
      interpretGitHubDelivery(
        {
          event: 'issue_comment',
          payload: issue({
            action: 'created',
            comment: { body: '@sainte-beuve-bot status', user: { login } },
          }),
        },
        context,
      )
    expect(from('reviewer', suffixed)).toMatchObject({ verb: 'status' })
    expect(from('sainte-beuve-bot[bot]', suffixed)).toBeNull()
    // Configured WITHOUT the suffix, against the comment GitHub actually writes.
    expect(from('sainte-beuve-bot[bot]', CONTEXT)).toBeNull()
  })
})

describe('parseBotCommand', () => {
  it('accepts the aliases a person would reach for', () => {
    expect(parseBotCommand('@bot assign', 'bot')).toBe('review')
    expect(parseBotCommand('@bot reassign', 'bot')).toBe('reroll')
    expect(parseBotCommand('@BOT Status', 'bot')).toBe('status')
  })

  it('refuses a verb it does not know', () => {
    expect(parseBotCommand('@bot deploy', 'bot')).toBeNull()
  })

  it('reads only what follows the mention', () => {
    // A verb before the name is prose, not a command with an argument. The
    // mention with nothing after it means the obvious thing instead.
    expect(parseBotCommand('status @bot', 'bot')).toBe('review')
  })

  it('does not match a longer login that starts the same way', () => {
    expect(parseBotCommand('@bot-staging review', 'bot')).toBeNull()
  })

  it('reads the verb after an App mention that carries the [bot] suffix', () => {
    // The suffix is consumed rather than tolerated: a mention that stopped
    // before it would read `[bot]` as the verb and fall through to the
    // bare-mention default, so `status` would silently assign a reviewer.
    expect(parseBotCommand('@bot[bot] status', 'bot')).toBe('status')
    expect(parseBotCommand('@bot[bot] status', 'bot[bot]')).toBe('status')
    expect(parseBotCommand('@bot status', 'bot[bot]')).toBe('status')
    expect(parseBotCommand('@bot[bot]', 'bot')).toBe('review')
  })

  it('answers nothing at all for a blank login', () => {
    expect(parseBotCommand('is @ anybody there', '')).toBeNull()
    expect(parseBotCommand('@ review', '   ')).toBeNull()
  })
})

describe('interpretGitHubDelivery: everything else', () => {
  it('ignores an event this deployment does not read', () => {
    expect(interpretGitHubDelivery({ event: 'push', payload: {} }, CONTEXT)).toBeNull()
  })
})
