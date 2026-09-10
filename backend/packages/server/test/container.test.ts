import type { Logger, Repositories } from '@sainte-beuve/kernel'
import { createInMemoryRepositories } from '@sainte-beuve/persistence-memory'
import { beforeEach, describe, expect, it } from 'vitest'
import { createContainer, DEFAULT_GITHUB_LABELS } from '../src/container.js'

// The container is where a facade's configuration becomes capabilities, so it is
// where "blank counts as absent" has to hold: every example deployment ships each
// variable with no value, and a copied file gives `''` rather than nothing.

const logger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

describe('createContainer', () => {
  let repositories: Repositories

  beforeEach(() => {
    repositories = createInMemoryRepositories()
  })

  it('reads a blank configuration value as unconfigured', () => {
    // `requireCapability` refuses only null, so an empty webhook secret would
    // otherwise sail past the 503 that names the variable and reach Web Crypto,
    // which refuses a zero-length HMAC key.
    const blank = createContainer({
      repositories,
      logger,
      github: { appSlug: '', webhookSecret: '', botLogin: '   ' },
      slack: { signingSecret: '', announcementChannelId: '' },
      appBaseUrl: '',
    })
    expect(blank.github).toMatchObject({ appSlug: null, webhookSecret: null, botLogin: null })
    expect(blank.slack).toStrictEqual({ signingSecret: null, announcementChannelId: null })
    expect(blank.appBaseUrl).toBeNull()
  })

  it('falls back to the label conventions rather than matching an empty label', () => {
    // An empty review label matches no label at all, so labelling a pull request
    // would do nothing while the Configuration screen showed no fault.
    const blank = createContainer({
      repositories,
      logger,
      github: { labels: { review: '', aiReview: 'ai', skillPrefix: '' } },
    })
    expect(blank.github.labels).toStrictEqual({
      review: DEFAULT_GITHUB_LABELS.review,
      aiReview: 'ai',
      skillPrefix: DEFAULT_GITHUB_LABELS.skillPrefix,
    })
  })

  it('keeps what a deployment did configure', () => {
    const wired = createContainer({
      repositories,
      logger,
      github: { webhookSecret: 'hook', botLogin: 'sainte-beuve-bot' },
      slack: { signingSecret: 'shh', announcementChannelId: 'C-reviews' },
      appBaseUrl: 'https://board.example',
    })
    expect(wired.github).toMatchObject({ webhookSecret: 'hook', botLogin: 'sainte-beuve-bot' })
    expect(wired.slack.announcementChannelId).toBe('C-reviews')
    expect(wired.appBaseUrl).toBe('https://board.example')
  })
})
