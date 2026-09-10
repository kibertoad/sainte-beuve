import type {
  CreateReviewerInput,
  CreateReviewRequestInput,
  Reviewer,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import type { Logger } from '@sainte-beuve/kernel'
import { createInMemoryRepositories } from '@sainte-beuve/persistence-memory'
import type { Hono } from 'hono'
import { expect } from 'vitest'
import { createApp } from '../src/app.js'
import { type AppContainer, createContainer } from '../src/container.js'
import type { AppEnv } from '../src/http/env.js'

/** A logger that keeps quiet unless a test wants to read what was logged. */
function silentLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
}

/** A clock a test moves by hand, so nothing depends on how long the suite took. */
function fixedClock(start = 1_000_000): {
  now: () => number
  advance: (ms: number) => void
} {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

/** Sequential ids, so an assertion can name the row it means. */
function sequentialIds(prefix = 'id'): { next: () => string } {
  let n = 0
  return { next: () => `${prefix}-${++n}` }
}

export interface TestHarness {
  app: Hono<AppEnv>
  container: AppContainer
  clock: ReturnType<typeof fixedClock>
}

export function buildHarness(overrides: Partial<AppContainer> = {}): TestHarness {
  const clock = fixedClock()
  const container: AppContainer = {
    ...createContainer({
      repositories: createInMemoryRepositories(),
      logger: silentLogger(),
      clock,
      ids: sequentialIds(),
      // A fixed draw so an assertion can name the reviewer the router picked.
      random: () => 0,
    }),
    ...overrides,
  }
  return { app: createApp({ resolveContainer: () => container }), container, clock }
}

function json(method: string, path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const post = (path: string, body: unknown) => json('POST', path, body)
export const patch = (path: string, body: unknown) => json('PATCH', path, body)
export const put = (path: string, body: unknown) => json('PUT', path, body)
export const del = (path: string): Request =>
  new Request(`http://localhost${path}`, { method: 'DELETE' })

/** The pull request every suite tracks, unless it needs a second one. */
export const PR: CreateReviewRequestInput['pullRequest'] = {
  provider: 'github',
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 7,
  url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
}

export async function addReviewer(
  harness: TestHarness,
  reviewer: CreateReviewerInput,
): Promise<Reviewer> {
  const res = await harness.app.fetch(post('/api/v1/reviewers', reviewer))
  expect(res.status).toBe(201)
  return (await res.json()) as Reviewer
}

export async function openReview(
  harness: TestHarness,
  overrides: Partial<CreateReviewRequestInput> = {},
): Promise<ReviewRequest> {
  const res = await harness.app.fetch(
    post('/api/v1/reviews', {
      pullRequest: PR,
      title: 'Add a health check',
      authorLogin: 'author',
      ...overrides,
    }),
  )
  expect(res.status).toBe(201)
  return (await res.json()) as ReviewRequest
}

export async function assignReviewer(harness: TestHarness, reviewId: string): Promise<Response> {
  return harness.app.fetch(post(`/api/v1/reviews/${reviewId}/assign`, { count: 1 }))
}
