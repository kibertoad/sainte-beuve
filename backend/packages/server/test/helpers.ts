import type {
  CreateReviewerInput,
  CreateReviewRequestInput,
  OpenPullRequest,
  ProjectRef,
  Reviewer,
  ReviewRequest,
  VcsProvider,
} from '@sainte-beuve/contracts'
import type { ChatGateway, GatewayFactory, Logger, VcsGateway } from '@sainte-beuve/kernel'
import { createInMemoryRepositories } from '@sainte-beuve/persistence-memory'
import type { Hono } from 'hono'
import { expect } from 'vitest'
import { createApp } from '../src/app.js'
import {
  type AppContainer,
  type EnvironmentVcsGateways,
  createContainer,
} from '../src/container.js'
import { secretsFrom } from '../src/crypto/WebCryptoSecretCipher.js'
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

export interface HarnessOptions {
  /**
   * The deployment's encryption key, base64. Wires the cipher AND the state
   * signer from it, both against the harness clock, which is what a connect
   * round trip needs: the state is minted at the harness's "now", so a signer
   * reading real time would treat it as expired the moment it is presented.
   */
  encryptionKey?: string
}

export function buildHarness(
  overrides: Partial<AppContainer> = {},
  options: HarnessOptions = {},
): TestHarness {
  const clock = fixedClock()
  const container: AppContainer = {
    ...createContainer({
      repositories: createInMemoryRepositories(),
      logger: silentLogger(),
      clock,
      ids: sequentialIds(),
      // A fixed draw so an assertion can name the reviewer the router picked.
      random: () => 0,
      secrets:
        options.encryptionKey === undefined
          ? null
          : secretsFrom({
              masterKeyBase64: options.encryptionKey,
              logger: silentLogger(),
              clock,
            }),
    }),
    ...overrides,
  }
  return { app: createApp({ resolveContainer: () => container }), container, clock }
}

/**
 * A gateway factory over whatever a case cares about.
 *
 * Every member is optional and the defaults throw, because a case that stores a
 * Slack token and asserts on GitHub should fail loudly rather than pass against
 * a gateway that quietly does nothing. `vcsAsApp` and `signIn` default to NULL
 * rather than throwing: absent is a real deployment state for both, and it is
 * the state most cases want.
 */
export function stubGateways(overrides: Partial<GatewayFactory> = {}): GatewayFactory {
  return {
    chat: () => {
      throw new Error('this case wired no chat gateway')
    },
    vcsFromToken: () => {
      throw new Error('this case wired no VCS gateway')
    },
    vcsAsApp: () => null,
    aiReview: () => null,
    signIn: () => null,
    ...overrides,
  }
}

/** One gateway for every host, for a case that does not care which one answers. */
export function everyHost<T>(gateway: T): (provider: VcsProvider) => T {
  return () => gateway
}

/** The environment's own gateway, on GitHub only, which is what most cases mean. */
export function environmentVcs(gateway: VcsGateway): EnvironmentVcsGateways {
  return { github: gateway, gitlab: null }
}

/** A VCS gateway that records what it was asked to do and answers nothing. */
export function recordingVcs(): VcsGateway & {
  comments: { body: string; number: number }[]
  requested: string[][]
  withdrawn: string[][]
} {
  const comments: { body: string; number: number }[] = []
  const requested: string[][] = []
  const withdrawn: string[][] = []
  return {
    comments,
    requested,
    withdrawn,
    requestReviewers: async (pr, logins) => {
      requested.push(logins)
      void pr
    },
    removeRequestedReviewers: async (pr, logins) => {
      withdrawn.push(logins)
      void pr
    },
    comment: async (pr, body) => {
      comments.push({ body, number: pr.number })
    },
    identify: async () => ({
      subject: '1',
      username: 'sainte-beuve-bot',
      displayName: null,
      avatarUrl: null,
    }),
    listOpenPullRequests: async () => [],
  }
}

/** A chat gateway that records what it posted where. */
export function recordingChat(): ChatGateway & { posted: { target: string; kind: string }[] } {
  const posted: { target: string; kind: string }[] = []
  return {
    posted,
    announceReview: async (_review, channelId) => {
      posted.push({ target: channelId, kind: 'announcement' })
      return { messageId: 'ts-1' }
    },
    sendReminder: async (reminder, _review, target) => {
      posted.push({ target, kind: reminder.kind })
    },
  }
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
export const get = (path: string): Request => new Request(`http://localhost${path}`)

/** A form-encoded POST, which is the only shape Slack sends. */
export function form(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  })
}

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

/**
 * A source-control gateway acting as one named person, over a fixed list of
 * open pull requests. What the workspace suite needs and the board suite does
 * not, so it is separate from `recordingVcs`.
 */
export function viewerVcs(
  username: string,
  pullRequests: OpenPullRequest[] = [],
): VcsGateway & { listed: ProjectRef[] } {
  const listed: ProjectRef[] = []
  return {
    listed,
    requestReviewers: async () => {},
    removeRequestedReviewers: async () => {},
    comment: async () => {},
    listOpenPullRequests: async (project) => {
      listed.push(project)
      return pullRequests.filter(
        (pr) => pr.pullRequest.owner === project.owner && pr.pullRequest.repo === project.repo,
      )
    },
    identify: async () => ({
      subject: `subject-${username}`,
      username,
      displayName: null,
      avatarUrl: null,
    }),
  }
}

/** One open pull request, with only the fields a case cares about spelled out. */
export function openPullRequest(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    pullRequest: { ...PR, ...overrides.pullRequest },
    title: 'A change',
    authorLogin: 'someone',
    requestedReviewerLogins: [],
    draft: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}
