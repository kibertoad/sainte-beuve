import type { ReviewLabelRules } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  type GitLabEventPayload,
  type GitLabIntentContext,
  interpretGitLabDelivery,
} from './events.js'

// What a GitLab delivery MEANS, against fixtures shaped like GitLab's Merge
// Request Hook and Note Hook. Same intents as the GitHub reader, so the board
// behaves the same whichever host a team is on.

const LABELS: ReviewLabelRules = {
  review: 'needs-review',
  aiReview: 'ai-review',
  skillPrefix: 'skill:',
}

const CONTEXT: GitLabIntentContext = { labels: LABELS, botUsername: 'review-bot' }

const MR_URL = 'https://gitlab.com/acme/platform/api/-/merge_requests/7'

const REF = {
  provider: 'gitlab',
  owner: 'acme/platform',
  repo: 'api',
  number: 7,
  url: MR_URL,
}

function mergeRequest(
  action: string,
  overrides: Partial<GitLabEventPayload> = {},
  attributes: Record<string, unknown> = {},
): GitLabEventPayload {
  return {
    object_kind: 'merge_request',
    user: { username: 'ada' },
    project: { path_with_namespace: 'acme/platform/api' },
    object_attributes: {
      iid: 7,
      title: 'Add a health check',
      url: MR_URL,
      action,
      draft: false,
      ...attributes,
    },
    labels: [],
    ...overrides,
  }
}

function note(body: string, overrides: Partial<GitLabEventPayload> = {}): GitLabEventPayload {
  return {
    object_kind: 'note',
    user: { username: 'grace' },
    project: { path_with_namespace: 'acme/platform/api' },
    object_attributes: { note: body, noteable_type: 'MergeRequest' },
    merge_request: { iid: 7, title: 'Add a health check', url: MR_URL },
    ...overrides,
  }
}

describe('interpretGitLabDelivery: merge requests', () => {
  it('tracks an opened merge request, unassigned, with its author and skills', () => {
    const intents = interpretGitLabDelivery(
      mergeRequest('open', { labels: [{ title: 'skill:payments' }, { title: 'bug' }] }),
      CONTEXT,
    )
    expect(intents).toStrictEqual([
      {
        kind: 'track',
        route: false,
        review: {
          pullRequest: REF,
          title: 'Add a health check',
          authorLogin: 'ada',
          requiredSkills: ['payments'],
          priority: 'normal',
          dueAt: null,
        },
      },
    ])
  })

  it('leaves a draft alone until it leaves draft, then tracks it', () => {
    expect(interpretGitLabDelivery(mergeRequest('open', {}, { draft: true }), CONTEXT)).toEqual([])
    const ready = mergeRequest('update', { changes: { draft: { previous: true, current: false } } })
    expect(interpretGitLabDelivery(ready, CONTEXT)).toMatchObject([{ kind: 'track', route: false }])
  })

  it('reads the older work_in_progress flag as draft too', () => {
    const wip = mergeRequest('reopen', {}, { draft: undefined, work_in_progress: true })
    expect(interpretGitLabDelivery(wip, CONTEXT)).toEqual([])
  })

  it('routes on the review label and delegates on the AI label, each only when added', () => {
    const labelled = mergeRequest('update', {
      labels: [{ title: 'needs-review' }, { title: 'ai-review' }],
      changes: {
        labels: {
          previous: [{ title: 'bug' }],
          current: [{ title: 'bug' }, { title: 'needs-review' }, { title: 'ai-review' }],
        },
      },
    })
    expect(interpretGitLabDelivery(labelled, CONTEXT)).toMatchObject([
      // The actor of an update is not the author, and the payload carries the
      // author only as an id.
      { kind: 'track', route: true, review: { authorLogin: 'unknown' } },
      { kind: 'ai_review', pullRequest: REF },
    ])
  })

  it('does nothing for a label that was already there or matches no rule', () => {
    const relabelled = mergeRequest('update', {
      changes: {
        labels: {
          previous: [{ title: 'needs-review' }],
          current: [{ title: 'needs-review' }, { title: 'needs review' }],
        },
      },
    })
    expect(interpretGitLabDelivery(relabelled, CONTEXT)).toEqual([])
  })

  it('closes on merge and on close', () => {
    for (const action of ['merge', 'close']) {
      expect(interpretGitLabDelivery(mergeRequest(action), CONTEXT)).toStrictEqual([
        { kind: 'close', pullRequest: REF },
      ])
    }
  })

  it('resolves on the merge request becoming approved, and re-opens when that is taken back', () => {
    expect(interpretGitLabDelivery(mergeRequest('approved'), CONTEXT)).toStrictEqual([
      { kind: 'resolve', pullRequest: REF, status: 'approved' },
    ])
    expect(interpretGitLabDelivery(mergeRequest('unapproved'), CONTEXT)).toStrictEqual([
      { kind: 'unapprove', pullRequest: REF },
    ])
  })

  it('settles nothing on one person approving under rules that want more', () => {
    expect(interpretGitLabDelivery(mergeRequest('approval'), CONTEXT)).toEqual([])
    expect(interpretGitLabDelivery(mergeRequest('unapproval'), CONTEXT)).toEqual([])
  })

  it('ignores a project path it cannot split into a namespace and a repo', () => {
    const flat = mergeRequest('open', { project: { path_with_namespace: 'api' } })
    expect(interpretGitLabDelivery(flat, CONTEXT)).toEqual([])
  })

  it('ignores every other hook', () => {
    expect(interpretGitLabDelivery({ object_kind: 'push' }, CONTEXT)).toEqual([])
  })
})

describe('interpretGitLabDelivery: notes', () => {
  it('reads a mention with a verb as that command, from whoever wrote it', () => {
    expect(interpretGitLabDelivery(note('@review-bot reroll please'), CONTEXT)).toStrictEqual([
      { kind: 'command', pullRequest: REF, requester: 'grace', verb: 'reroll' },
    ])
  })

  it('takes a bare mention, even at the end of a sentence, as asking for a reviewer', () => {
    expect(interpretGitLabDelivery(note('Can you look, @review-bot.'), CONTEXT)).toMatchObject([
      { verb: 'review' },
    ])
  })

  it('does not answer a longer handle that starts with the bot name', () => {
    expect(interpretGitLabDelivery(note('@review-bot.staging status'), CONTEXT)).toEqual([])
    expect(interpretGitLabDelivery(note('@review-bot_2 status'), CONTEXT)).toEqual([])
  })

  it('answers no command when no bot is known', () => {
    const silent = { ...CONTEXT, botUsername: null }
    expect(interpretGitLabDelivery(note('@review-bot review'), silent)).toEqual([])
  })

  it('ignores the bot itself, a note on anything else, and an edited note', () => {
    expect(
      interpretGitLabDelivery(
        note('@review-bot status', { user: { username: 'Review-Bot' } }),
        CONTEXT,
      ),
    ).toEqual([])
    const onIssue = note('@review-bot status', {
      object_attributes: { note: '@review-bot status', noteable_type: 'Issue' },
    })
    expect(interpretGitLabDelivery(onIssue, CONTEXT)).toEqual([])
    const edited = note('@review-bot status', {
      object_attributes: {
        note: '@review-bot status',
        noteable_type: 'MergeRequest',
        action: 'update',
      },
    })
    expect(interpretGitLabDelivery(edited, CONTEXT)).toEqual([])
  })
})
