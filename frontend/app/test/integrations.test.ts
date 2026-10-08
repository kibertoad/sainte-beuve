import type { Connections, VcsConnection } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { catFactoryBadge, integrationEntries, vcsBadge } from '../app/utils/integrations'

function host(overrides: Partial<VcsConnection> = {}): VcsConnection {
  return {
    provider: 'github',
    activeMethod: null,
    availableMethods: ['pat'],
    appInstallable: false,
    account: null,
    inboundIntake: true,
    webhooksReady: false,
    botLogin: null,
    labels: { review: 'needs-review', aiReview: 'ai-review', skillPrefix: 'skill:' },
    ...overrides,
  }
}

const connections: Connections = {
  vcs: [host(), host({ provider: 'gitlab' })],
  slack: {
    ready: true,
    announcementChannelId: null,
    interactivityReady: false,
    requestPath: '/webhooks/slack',
  },
  catFactory: { config: null, suggested: null, aiReviewReady: false, guidedReviewReady: false },
}

describe('integrationEntries', () => {
  it('lists every host the API reports, then Slack and cat-factory, each with its screen', () => {
    expect(integrationEntries(connections).map((entry) => [entry.name, entry.to])).toEqual([
      ['GitHub', '/configuration/github'],
      ['GitLab', '/configuration/gitlab'],
      ['Slack', '/configuration/slack'],
      ['cat-factory', '/configuration/cat-factory'],
    ])
  })

  it('reports each one with the badge its own screen shows', () => {
    expect(integrationEntries(connections).map((entry) => entry.badge.label)).toEqual([
      'Not connected',
      'Not connected',
      'Delivering',
      'Not configured',
    ])
  })
})

describe('vcsBadge', () => {
  it('names the account only for a sign-in, which is the one credential that is a person', () => {
    expect(vcsBadge(host({ activeMethod: 'oauth', account: 'kibertoad' })).label).toBe(
      'Signed in as kibertoad',
    )
    expect(vcsBadge(host({ activeMethod: 'pat', account: 'kibertoad' })).label).toBe(
      'Using a personal access token',
    )
  })
})

describe('catFactoryBadge', () => {
  it('says when only guided review can run', () => {
    expect(catFactoryBadge({ ...connections.catFactory, guidedReviewReady: true })).toEqual({
      color: 'warning',
      label: 'Guided review only',
    })
  })
})
