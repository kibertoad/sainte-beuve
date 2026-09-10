import type { Logger } from '@sainte-beuve/kernel'
import { createInMemoryRepositories } from '@sainte-beuve/persistence-memory'
import type { Hono } from 'hono'
import { type AppContainer, createContainer } from '../src/container.js'
import { createApp } from '../src/app.js'
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
