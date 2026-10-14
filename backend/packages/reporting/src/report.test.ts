import type { PullRequestTimeline, ReviewEvent } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { isAutomatedReviewer } from './automation.js'
import { milestonesOf } from './milestones.js'
import { buildReviewReport } from './report.js'
import { quantile, summarize } from './stats.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = 1_000 * DAY

function review(login: string, atHours: number, overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return { login, bot: false, kind: 'commented', at: NOW - 10 * DAY + atHours * HOUR, ...overrides }
}

/** Ready ten days before NOW unless told otherwise; `at` offsets are hours after that. */
function pr(number: number, overrides: Partial<PullRequestTimeline> = {}): PullRequestTimeline {
  const readyAt = NOW - 10 * DAY
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/api/pull/${number}`,
    authorLogin: 'bob',
    draft: false,
    createdAt: readyAt,
    readyAt,
    mergedAt: null,
    closedAt: null,
    reviews: [],
    ...overrides,
  }
}

function project(id: string) {
  return { id, provider: 'github' as const, owner: 'acme', repo: id }
}

describe('isAutomatedReviewer', () => {
  it.each([
    ['coderabbitai[bot]', false, true],
    ['CodeRabbitAI', false, true],
    ['copilot-pull-request-reviewer', false, true],
    ['renovate[bot]', false, true],
    ['service-account', true, true],
    ['ada', false, false],
  ])('reads %s (host bot: %s) as automated: %s', (login, hostBot, expected) => {
    expect(isAutomatedReviewer(login, hostBot)).toBe(expected)
  })
})

describe('milestonesOf', () => {
  it('times each milestone from readiness, leaving out the author and bots where asked', () => {
    const outcomes = milestonesOf(
      pr(1, {
        mergedAt: NOW - 10 * DAY + 30 * HOUR,
        closedAt: NOW - 10 * DAY + 30 * HOUR,
        reviews: [
          review('bob', 1),
          review('coderabbitai[bot]', 2, { bot: true }),
          review('ada', 5),
          review('carol', 20, { kind: 'approved' }),
        ],
      }),
      NOW,
    )
    expect(outcomes).toEqual({
      first_review: { state: 'reached', afterMs: 2 * HOUR },
      first_human_review: { state: 'reached', afterMs: 5 * HOUR },
      approval: { state: 'reached', afterMs: 20 * HOUR },
      merge: { state: 'reached', afterMs: 30 * HOUR },
    })
  })

  it('reads an open pull request as waiting, and a closed one as excluded', () => {
    expect(milestonesOf(pr(1), NOW).first_review).toEqual({ state: 'waiting', forMs: 10 * DAY })
    expect(milestonesOf(pr(2, { closedAt: NOW - DAY }), NOW).first_review).toEqual({
      state: 'excluded',
    })
  })

  it('counts a review given while it was a draft as immediate', () => {
    const readyAt = NOW - 5 * DAY
    const outcome = milestonesOf(
      pr(1, { createdAt: NOW - 10 * DAY, readyAt, reviews: [review('ada', 1)] }),
      NOW,
    )
    expect(outcome.first_review).toEqual({ state: 'reached', afterMs: 0 })
  })
})

describe('summarize', () => {
  it('interpolates the median and p90 and keeps the waiting count apart', () => {
    expect(summarize([4, 1, 3, 2], 2)).toEqual({
      reached: 4,
      waiting: 2,
      medianMs: 3,
      p90Ms: 4,
      meanMs: 3,
    })
    expect(quantile([10, 20], 0.5)).toBe(15)
    expect(summarize([], 1)).toMatchObject({ reached: 0, medianMs: null, meanMs: null })
  })
})

describe('buildReviewReport', () => {
  it('pools every repository, leaving out drafts and what was opened before the window', () => {
    const report = buildReviewReport({
      repositories: [
        {
          project: project('api'),
          pullRequests: [
            pr(1, { reviews: [review('ada', 2)] }),
            pr(2, { draft: true }),
            pr(3, { createdAt: NOW - 40 * DAY, readyAt: NOW - 40 * DAY }),
          ],
        },
        { project: project('web'), pullRequests: [pr(4, { reviews: [review('ada', 4)] })] },
      ],
      days: 30,
      now: NOW,
      projectId: null,
    })
    expect(report.since).toBe(NOW - 30 * DAY)
    expect(report.pullRequests).toBe(2)
    expect(report.metrics.first_review).toMatchObject({ reached: 2, medianMs: 3 * HOUR })
    expect(report.repositories.map((repository) => repository.repo)).toEqual(['api', 'web'])
  })

  it('names a repository far slower than the rest, and one whose pull requests sit unreviewed', () => {
    const fast = [1, 2, 3, 4].map((n) => pr(n, { reviews: [review('ada', 1)] }))
    const slow = [5, 6, 7].map((n) => pr(n, { reviews: [review('ada', 48)] }))
    const stalled = [
      pr(8, { reviews: [review('ada', 1)] }),
      pr(9, { readyAt: NOW - 9 * DAY, createdAt: NOW - 9 * DAY }),
      pr(10, { readyAt: NOW - 8 * DAY, createdAt: NOW - 8 * DAY }),
    ]
    const report = buildReviewReport({
      repositories: [
        { project: project('fast'), pullRequests: fast },
        { project: project('slow'), pullRequests: slow },
        { project: project('stalled'), pullRequests: stalled },
      ],
      days: 30,
      now: NOW,
      projectId: null,
    })
    const reviewHotspots = report.hotspots.filter((spot) => spot.milestone === 'first_review')
    expect(reviewHotspots).toEqual([
      expect.objectContaining({ projectId: 'stalled', reason: 'stalled', overdue: 2 }),
      expect.objectContaining({ projectId: 'slow', reason: 'slow', medianMs: 48 * HOUR }),
    ])
  })

  it('finds no hotspots in a report on one repository', () => {
    const report = buildReviewReport({
      repositories: [{ project: project('api'), pullRequests: [pr(1), pr(2), pr(3)] }],
      days: 30,
      now: NOW,
      projectId: 'api',
    })
    expect(report.hotspots).toEqual([])
  })

  it('lists the longest waits for a human review, the ones still waiting included', () => {
    const report = buildReviewReport({
      repositories: [
        {
          project: project('api'),
          pullRequests: [
            pr(1, { reviews: [review('ada', 3)] }),
            pr(2),
            pr(3, { closedAt: NOW - DAY }),
            pr(4, { reviews: [review('coderabbitai', 1), review('ada', 50)] }),
          ],
        },
      ],
      days: 30,
      now: NOW,
      projectId: 'api',
    })
    expect(report.slowest.map((row) => [row.number, row.waitMs, row.waiting])).toEqual([
      [2, 10 * DAY, true],
      [4, 50 * HOUR, false],
      [1, 3 * HOUR, false],
    ])
  })
})
