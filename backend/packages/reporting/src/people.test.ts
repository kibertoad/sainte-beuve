import type { PullRequestTimeline, ReviewEvent } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { buildReviewReport } from './report.js'

const HOUR = 60 * 60 * 1000
const NOW = 1_000 * 24 * HOUR
const READY = NOW - 5 * 24 * HOUR

function review(
  login: string,
  afterHours: number,
  overrides: Partial<ReviewEvent> = {},
): ReviewEvent {
  return { login, bot: false, kind: 'commented', at: READY + afterHours * HOUR, ...overrides }
}

function pr(number: number, author: string, reviews: ReviewEvent[] = []): PullRequestTimeline {
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/api/pull/${number}`,
    authorLogin: author,
    authorBot: false,
    draft: false,
    createdAt: READY,
    readyAt: READY,
    mergedAt: null,
    closedAt: null,
    reviews,
  }
}

function peopleIn(pullRequests: PullRequestTimeline[], provider: 'github' | 'gitlab' = 'github') {
  return buildReviewReport({
    repositories: [{ project: { id: 'p1', provider, owner: 'acme', repo: 'api' }, pullRequests }],
    days: 30,
    now: NOW,
    projectId: null,
    directory: [
      { id: 'r-ada', displayName: 'Ada Lovelace', handles: { github: ' Ada ', gitlab: null } },
    ],
  }).people
}

describe('people', () => {
  it('counts each pull request once per reviewer, with approvals and who got there first', () => {
    const people = peopleIn([
      pr(1, 'bob', [
        review('coderabbitai[bot]', 0.5, { bot: true }),
        review('ada', 2),
        review('carol', 3),
        review('ada', 4, { kind: 'approved' }),
        review('bob', 5),
      ]),
      pr(2, 'carol', [review('carol', 1), review('ADA', 6)]),
    ])

    expect(people.map((person) => person.login)).toEqual(['ada', 'carol', 'bob'])
    expect(people[0]).toMatchObject({
      provider: 'github',
      reviewerId: 'r-ada',
      displayName: 'Ada Lovelace',
      reviewed: 2,
      approved: 1,
      firstToReview: 2,
      authored: 0,
    })
    expect(people[1]).toMatchObject({ reviewed: 1, approved: 0, firstToReview: 0, authored: 1 })
  })

  it('times how quickly the pull requests a person opened were reviewed', () => {
    const people = peopleIn([
      pr(1, 'bob', [review('ada', 2)]),
      pr(2, 'bob', [review('ada', 6)]),
      pr(3, 'bob'),
    ])
    const bob = people.find((person) => person.login === 'bob')
    expect(bob?.authored).toBe(3)
    expect(bob?.authoredMetrics.first_human_review).toMatchObject({
      reached: 2,
      waiting: 1,
      medianMs: 4 * HOUR,
    })
    expect(bob?.longestWaitingMs).toBe(5 * 24 * HOUR)
    expect(people.find((person) => person.login === 'ada')?.longestWaitingMs).toBeNull()
    expect(bob?.reviewerId).toBeNull()
  })

  it('leaves bots out, as authors and as reviewers', () => {
    const people = peopleIn([
      pr(1, 'renovate[bot]', [review('copilot', 1), review('ada', 2)]),
      { ...pr(2, 'release-app'), authorBot: true },
    ])
    expect(people.map((person) => person.login)).toEqual(['ada'])
  })

  it('matches the directory on the handle for the host the pull request is on', () => {
    const people = peopleIn([pr(1, 'bob', [review('ada', 1)])], 'gitlab')
    expect(people[0]).toMatchObject({ provider: 'gitlab', login: 'ada', reviewerId: null })
  })
})
