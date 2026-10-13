import type { ConflictResolution, OpenPullRequest, Project } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { stubAiReview } from './ai-review-doubles.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import {
  buildHarness,
  environmentVcs,
  openPullRequest,
  post,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

const RESOLVE = '/api/v1/my-pull-requests/resolve-conflicts'

function pr(number: number, authorLogin = 'ada'): OpenPullRequest {
  return openPullRequest({
    authorLogin,
    pullRequest: {
      provider: 'github',
      owner: 'acme',
      repo: 'api',
      number,
      url: `https://github.com/acme/api/pull/${number}`,
    },
  })
}

/**
 * Ada's pull request 1 conflicts with its base; 2 is clean; 3 is Bob's and conflicts;
 * 4 is one the host has not checked yet.
 */
async function setUp(options: { catFactory: boolean }) {
  const vcs = viewerVcs('ada', [pr(1), pr(2), pr(3, 'bob'), pr(4)], {
    1: { mergeability: 'conflicting' },
    3: { mergeability: 'conflicting', authorLogin: 'bob' },
    4: { mergeability: 'checking' },
  })
  const aiReview = stubAiReview()
  const harness = buildHarness({
    vcs: environmentVcs(vcs),
    ...(options.catFactory ? catFactoryWired({ aiReview }) : {}),
  })
  // Registered first: once cat-factory is connected, its directory owns the project list.
  const res = await harness.app.fetch(
    post('/api/v1/projects', { provider: 'github', owner: 'acme', repo: 'api' }),
  )
  const project = (await res.json()) as Project
  if (options.catFactory) await connectCatFactory(harness)
  return { harness, aiReview, project }
}

function resolve(harness: TestHarness, project: Project, number: number) {
  return harness.app.fetch(post(RESOLVE, { projectId: project.id, number }))
}

describe('resolving conflicts from My PRs', () => {
  it("hands the author's conflicting pull request to cat-factory", async () => {
    const { harness, aiReview, project } = await setUp({ catFactory: true })

    const res = await resolve(harness, project, 1)

    expect(res.status).toBe(200)
    expect((await res.json()) as ConflictResolution).toStrictEqual({
      taskId: 'cf-conflicts-1',
      url: 'https://cat-factory.example.com/tasks/cf-conflicts-1',
    })
    expect(aiReview.conflictsResolved).toStrictEqual([
      {
        pullRequest: {
          provider: 'github',
          owner: 'acme',
          repo: 'api',
          number: 1,
          url: 'https://github.com/acme/api/pull/1',
        },
        directoryKeys: [],
      },
    ])
  })

  // The resolver works in the repository's own service, so it is placed as a review is.
  it('files with the directory keys cat-factory lists the repository under', async () => {
    const { harness, aiReview, project } = await setUp({ catFactory: true })
    const listed = (key: string, repo: string) => ({
      source: 'cat-factory',
      key,
      seq: 1,
      repository: { provider: 'github' as const, owner: 'acme', repo, id: key },
    })
    const { externalRepositories } = harness.container.repositories
    await externalRepositories.apply(listed('ws-b/42', 'api'))
    await externalRepositories.apply(listed('ws-a/42', 'api'))
    await externalRepositories.apply(listed('ws-a/43', 'web'))

    expect((await resolve(harness, project, 1)).status).toBe(200)
    expect(aiReview.conflictsResolved[0]?.directoryKeys).toStrictEqual(['ws-a/42', 'ws-b/42'])
  })

  it('refuses a pull request with nothing to resolve', async () => {
    const { harness, aiReview, project } = await setUp({ catFactory: true })

    expect((await resolve(harness, project, 2)).status).toBe(409)
    expect(aiReview.conflictsResolved).toStrictEqual([])
  })

  it('asks to retry while the host is still checking for conflicts', async () => {
    const { harness, aiReview, project } = await setUp({ catFactory: true })

    const res = await resolve(harness, project, 4)

    expect(res.status).toBe(409)
    expect(JSON.stringify(await res.json())).toContain('still checking')
    expect(aiReview.conflictsResolved).toStrictEqual([])
  })

  // The resolver pushes to the branch, so it is the author's call, as a merge is.
  it("refuses somebody else's pull request", async () => {
    const { harness, aiReview, project } = await setUp({ catFactory: true })

    expect((await resolve(harness, project, 3)).status).toBe(403)
    expect(aiReview.conflictsResolved).toStrictEqual([])
  })

  it('answers 503 naming the Configuration screen when cat-factory is not configured', async () => {
    const { harness, project } = await setUp({ catFactory: false })

    const res = await resolve(harness, project, 1)

    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).toContain('Configuration screen')
  })
})
