import type { MyPullRequests, OpenPullRequest } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { SNAPSHOT_MAX_AGE } from '../src/integrations/hostSnapshots.js'
import {
  buildHarness,
  environmentVcs,
  get,
  openPullRequest,
  post,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// The kept host reads, through a screen that sweeps: My PRs. What each store
// keeps is asserted in the conformance suite; this covers when the host is asked.

const PULL: OpenPullRequest = openPullRequest({
  authorLogin: 'ada',
  pullRequest: {
    provider: 'github',
    owner: 'acme',
    repo: 'api',
    number: 1,
    url: 'https://github.com/acme/api/pull/1',
  },
})

/** A host that lists `PULL`, until `failing` is set, when every listing is refused. */
function flakyHost() {
  const vcs = viewerVcs('ada', [PULL])
  const host = { failing: false, listings: 0 }
  const gateway = {
    ...vcs,
    listOpenPullRequests: async (...args: Parameters<typeof vcs.listOpenPullRequests>) => {
      host.listings += 1
      if (host.failing) throw new Error('GitHub answered 403: secondary rate limit')
      return vcs.listOpenPullRequests(...args)
    },
  }
  return { gateway, host }
}

async function connected(): Promise<{
  harness: TestHarness
  host: { failing: boolean; listings: number }
}> {
  const { gateway, host } = flakyHost()
  const harness = buildHarness({ vcs: environmentVcs(gateway) })
  const res = await harness.app.fetch(
    post('/api/v1/projects', { provider: 'github', owner: 'acme', repo: 'api' }),
  )
  expect(res.status).toBe(201)
  return { harness, host }
}

async function listed(harness: TestHarness): Promise<MyPullRequests> {
  const res = await harness.app.fetch(get('/api/v1/my-pull-requests'))
  expect(res.status).toBe(200)
  return (await res.json()) as MyPullRequests
}

describe('kept host reads', () => {
  it('serves a repository from its snapshot until the snapshot is too old', async () => {
    const { harness, host } = await connected()
    await listed(harness)
    await listed(harness)
    expect(host.listings).toBe(1)

    harness.clock.advance(SNAPSHOT_MAX_AGE.openPullRequests)
    await listed(harness)
    expect(host.listings).toBe(2)
  })

  it('serves the older snapshot when the host refuses a fresh read', async () => {
    const { harness, host } = await connected()
    await listed(harness)
    harness.clock.advance(SNAPSHOT_MAX_AGE.openPullRequests)
    host.failing = true

    const result = await listed(harness)

    expect(host.listings).toBe(2)
    expect(result.sources.every((source) => source.ok)).toBe(true)
    expect(result.pullRequests.map((row) => row.pullRequest.number)).toStrictEqual([1])
  })
})
