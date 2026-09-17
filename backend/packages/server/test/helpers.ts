import type {
  CreateReviewerInput,
  CreateReviewRequestInput,
  OpenPullRequest,
  ProjectRef,
  Reviewer,
  ReviewRequest,
  VcsProvider,
} from '@sainte-beuve/contracts'
import type {
  AttentionBus,
  ChatGateway,
  GatewayFactory,
  Logger,
  VcsGateway,
} from '@sainte-beuve/kernel'
import { createInMemoryPersistence } from '@sainte-beuve/persistence-memory'
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
  /**
   * The PROCESS-WIDE attention bus, for a case that wants to inspect it.
   *
   * An option rather than a container override, because the container carries
   * two: `attentionFanout` is the one a facade wires, and `bus` is the view
   * `withOrg` binds to an org. Overriding the bound one with a raw bus would
   * type-error and, worse, would be a stream nothing publishes to.
   */
  bus?: AttentionBus
  /**
   * The origins the deployment named, as a facade would have computed them.
   * Defaults to the wildcard every runtime ships, which is what most cases mean.
   */
  corsOrigins?: string[]
}

export function buildHarness(
  overrides: Partial<AppContainer> = {},
  options: HarnessOptions = {},
): TestHarness {
  const clock = fixedClock()
  const container: AppContainer = {
    ...createContainer({
      stores: createInMemoryPersistence(),
      logger: silentLogger(),
      clock,
      ids: sequentialIds(),
      // A fixed draw so an assertion can name the reviewer the router picked.
      random: () => 0,
      bus: options.bus,
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
  const app = createApp({
    resolveContainer: () => container,
    ...(options.corsOrigins === undefined ? {} : { corsOrigins: options.corsOrigins }),
  })
  return { app, container, clock }
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

function json(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

export const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  json('POST', path, body, headers)
export const patch = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  json('PATCH', path, body, headers)
export const put = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  json('PUT', path, body, headers)
export const del = (path: string, headers: Record<string, string> = {}): Request =>
  new Request(`http://localhost${path}`, { method: 'DELETE', headers })
export const get = (path: string, headers: Record<string, string> = {}): Request =>
  new Request(`http://localhost${path}`, { headers })

/**
 * A browser's cookie jar, for the round trips that now span two responses.
 *
 * A connect or sign-in flow sets a cookie on the answer that hands out the
 * authorize URL and reads it back on the callback, so a case that forwarded only
 * the `state` query parameter would be exercising a round trip no browser makes.
 * See `RoundTripState`.
 */
export function cookieJar(): {
  keep: (res: Response) => void
  headers: () => Record<string, string>
} {
  const held = new Map<string, string>()
  return {
    keep(res: Response): void {
      for (const line of res.headers.getSetCookie()) {
        const pair = line.split(';')[0] ?? ''
        const separator = pair.indexOf('=')
        if (separator <= 0) continue
        const value = pair.slice(separator + 1)
        // An empty value is a cookie being CLEARED, which is what `deleteCookie`
        // sends; keeping it would present a spent nonce on the next request.
        if (value.length === 0) held.delete(pair.slice(0, separator))
        else held.set(pair.slice(0, separator), value)
      }
    },
    headers(): Record<string, string> {
      if (held.size === 0) return {}
      return { cookie: [...held].map(([name, value]) => `${name}=${value}`).join('; ') }
    },
  }
}

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
      // The HOST is part of the match, as it is in a real adapter: a gateway
      // for one host cannot answer with the other's pull requests.
      return pullRequests.filter(
        (pr) =>
          pr.pullRequest.provider === project.provider &&
          pr.pullRequest.owner === project.owner &&
          pr.pullRequest.repo === project.repo,
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

/**
 * A gateway authenticated as the deployment's own App: it reaches repositories
 * and it identifies NOBODY, which is exactly what an installation token is.
 */
export function appVcs(pullRequests: OpenPullRequest[] = []): VcsGateway {
  return { ...viewerVcs('installation', pullRequests), identify: async () => null }
}

/** One open pull request, with only the fields a case cares about spelled out. */
export function openPullRequest(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    title: 'A change',
    authorLogin: 'someone',
    requestedReviewerLogins: [],
    draft: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
    // AFTER the spread, so a case that names one field of the ref gets that
    // field ON TOP of the default one. Before it, `{ pullRequest: { number: 5 } }`
    // would be overwritten wholesale and leave the provider, the owner and the
    // repo undefined, which no filter matches and no assertion notices.
    pullRequest: { ...PR, ...overrides.pullRequest },
  }
}
