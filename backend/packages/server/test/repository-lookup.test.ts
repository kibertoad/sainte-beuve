import type { RepositoryLookup } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { appVcs, buildHarness, environmentVcs, get, openPullRequest, viewerVcs } from './helpers.js'

const LOOKUP = '/api/v1/repositories/lookup'

function pr(owner: string, repo: string) {
  return openPullRequest({
    pullRequest: {
      provider: 'github',
      owner,
      repo,
      number: 1,
      url: `https://github.com/${owner}/${repo}/pull/1`,
    },
  })
}

describe('repository lookup', () => {
  it("suggests the owner's repositories whose names match", async () => {
    const vcs = viewerVcs('ada', [pr('acme', 'payments-api'), pr('acme', 'web')])
    const harness = buildHarness({ vcs: environmentVcs(vcs) })

    const res = await harness.app.fetch(get(`${LOOKUP}?provider=github&owner=acme&query=pay`))

    expect(res.status).toBe(200)
    expect((await res.json()) as RepositoryLookup).toStrictEqual({
      ownerFound: true,
      repositories: [{ repo: 'payments-api', description: null, private: false }],
    })
  })

  it('says so when the owner does not exist', async () => {
    const harness = buildHarness({ vcs: environmentVcs(viewerVcs('ada', [pr('acme', 'web')])) })

    const res = await harness.app.fetch(get(`${LOOKUP}?provider=github&owner=nobody&query=web`))

    expect(await res.json()).toStrictEqual({ ownerFound: false, repositories: [] })
  })

  it('refuses a query shorter than three characters', async () => {
    const harness = buildHarness({ vcs: environmentVcs(viewerVcs('ada')) })

    const res = await harness.app.fetch(get(`${LOOKUP}?provider=github&owner=acme&query=we`))

    expect(res.status).toBe(400)
  })

  it('answers 503 when the only credential is an App', async () => {
    const harness = buildHarness({ vcs: environmentVcs(appVcs()) })

    const res = await harness.app.fetch(get(`${LOOKUP}?provider=github&owner=acme&query=web`))

    expect(res.status).toBe(503)
  })

  it('answers 503 for a host with no credential', async () => {
    const harness = buildHarness({ vcs: environmentVcs(viewerVcs('ada')) })

    const res = await harness.app.fetch(get(`${LOOKUP}?provider=gitlab&owner=acme&query=web`))

    expect(res.status).toBe(503)
  })
})
