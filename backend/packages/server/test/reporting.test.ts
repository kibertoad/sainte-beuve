import type { ReviewReport } from '@sainte-beuve/contracts'
import type {
  OrgReviewReport,
  PullRequestTimeline,
  ReviewMetricsExporter,
  VcsGateway,
} from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { runReviewMetricsExport } from '../src/index.js'
import {
  addReviewer,
  buildHarness,
  environmentVcs,
  get,
  post,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// Reports through the app. The arithmetic is tested purely in
// @sainte-beuve/reporting; this suite covers the host read per linked project,
// the window, the narrowing to one project and the export pass.

const HOUR = 60 * 60 * 1000
const NOW = 1_000_000

function timeline(number: number, overrides: Partial<PullRequestTimeline> = {}) {
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/api/pull/${number}`,
    authorLogin: 'bob',
    draft: false,
    createdAt: NOW - 10 * HOUR,
    readyAt: NOW - 10 * HOUR,
    mergedAt: null,
    closedAt: null,
    reviews: [],
    ...overrides,
  }
}

async function addProject(harness: TestHarness, repo: string): Promise<string> {
  const res = await harness.app.fetch(
    post('/api/v1/projects', { provider: 'github', owner: 'acme', repo }),
  )
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

function vcsWith(overrides: Partial<VcsGateway>): VcsGateway {
  return { ...viewerVcs('ada'), ...overrides }
}

async function report(harness: TestHarness, query = ''): Promise<ReviewReport> {
  const res = await harness.app.fetch(get(`/api/v1/reports/reviews${query}`))
  expect(res.status).toBe(200)
  return (await res.json()) as ReviewReport
}

describe('review reports', () => {
  it('reads every linked repository over the window and reports what could not be read', async () => {
    const asked: { repo: string; since: number }[] = []
    const harness = buildHarness({
      vcs: environmentVcs(
        vcsWith({
          reviewTimelines: async (project, since) => {
            asked.push({ repo: project.repo, since })
            if (project.repo === 'broken') throw new Error('GitHub answered 502')
            return {
              pullRequests: [
                timeline(1, {
                  reviews: [
                    { login: 'coderabbitai', bot: true, kind: 'commented', at: NOW - 9 * HOUR },
                    { login: 'ada', bot: false, kind: 'approved', at: NOW - 6 * HOUR },
                  ],
                  mergedAt: NOW - 5 * HOUR,
                  closedAt: NOW - 5 * HOUR,
                }),
                timeline(2),
              ],
              truncated: project.repo === 'web',
            }
          },
        }),
      ),
    })
    await addProject(harness, 'api')
    await addProject(harness, 'web')
    await addProject(harness, 'broken')

    const body = await report(harness, '?days=7')

    expect(asked.map((entry) => entry.since)).toEqual([0, 0, 0].map(() => NOW - 7 * 24 * HOUR))
    expect(body).toMatchObject({ days: 7, projectId: null, pullRequests: 4 })
    expect(body.metrics.first_review).toMatchObject({ reached: 2, waiting: 2, medianMs: HOUR })
    expect(body.metrics.first_human_review.medianMs).toBe(4 * HOUR)
    expect(body.metrics.merge).toMatchObject({ reached: 2, medianMs: 5 * HOUR })
    expect(body.slowest[0]).toMatchObject({ number: 2, waiting: true, waitMs: 10 * HOUR })
    const sources = Object.fromEntries(body.sources.map((source) => [source.repo, source]))
    expect(sources.api).toMatchObject({ ok: true, truncated: false })
    expect(sources.web).toMatchObject({ ok: true, truncated: true })
    expect(sources.broken).toMatchObject({ ok: false, reason: 'GitHub answered 502' })
    expect(body.repositories.map((repository) => repository.repo).sort()).toEqual(['api', 'web'])
  })

  it('narrows to one project, and refuses one that is not linked', async () => {
    const asked: string[] = []
    const harness = buildHarness({
      vcs: environmentVcs(
        vcsWith({
          reviewTimelines: async (project) => {
            asked.push(project.repo)
            return { pullRequests: [timeline(1)], truncated: false }
          },
        }),
      ),
    })
    await addProject(harness, 'api')
    const web = await addProject(harness, 'web')

    const body = await report(harness, `?projectId=${web}`)
    expect(asked).toEqual(['web'])
    expect(body).toMatchObject({ projectId: web, days: 30, hotspots: [] })
    expect(body.repositories.map((repository) => repository.repo)).toEqual(['web'])

    const missing = await harness.app.fetch(get('/api/v1/reports/reviews?projectId=nope'))
    expect(missing.status).toBe(404)
    const invalid = await harness.app.fetch(get('/api/v1/reports/reviews?days=8'))
    expect(invalid.status).toBe(400)
  })

  it('names the people behind the handles from the directory', async () => {
    const harness = buildHarness({
      vcs: environmentVcs(
        vcsWith({
          reviewTimelines: async () => ({
            pullRequests: [
              timeline(1, {
                reviews: [{ login: 'Ada', bot: false, kind: 'approved', at: NOW - 8 * HOUR }],
              }),
            ],
            truncated: false,
          }),
        }),
      ),
    })
    await addReviewer(harness, { displayName: 'Ada Lovelace', handles: { github: 'ada' } })
    await addProject(harness, 'api')

    const { people } = await report(harness)
    expect(people.map((person) => [person.login, person.displayName, person.reviewed])).toEqual([
      ['Ada', 'Ada Lovelace', 1],
      ['bob', null, 0],
    ])
    expect(people[1]?.authoredMetrics.approval.medianMs).toBe(2 * HOUR)
  })

  it('reports a host with no credential per repository rather than failing', async () => {
    const harness = buildHarness()
    await addProject(harness, 'api')
    const body = await report(harness)
    expect(body.pullRequests).toBe(0)
    expect(body.repositories).toEqual([])
    expect(body.sources[0]).toMatchObject({ ok: false, truncated: false })
  })
})

describe('review metrics export', () => {
  function recordingExporter(): ReviewMetricsExporter & { pushed: OrgReviewReport[][] } {
    const pushed: OrgReviewReport[][] = []
    return {
      pushed,
      export: async (reports) => {
        pushed.push([...reports])
      },
    }
  }

  it('pushes one report per org that links a repository, over the exported window', async () => {
    const exporter = recordingExporter()
    const harness = buildHarness({
      reviewMetrics: exporter,
      vcs: environmentVcs(
        vcsWith({
          reviewTimelines: async () => ({ pullRequests: [timeline(1)], truncated: false }),
        }),
      ),
    })
    await addProject(harness, 'api')

    expect(await runReviewMetricsExport(harness.container)).toEqual({ exported: 1, failed: 0 })
    expect(exporter.pushed).toHaveLength(1)
    expect(exporter.pushed[0]?.[0]).toMatchObject({
      org: { id: 'org_default', slug: 'default' },
      report: { days: 30, pullRequests: 1 },
    })
  })

  it('does nothing without an exporter, and pushes nothing for an org with no repositories', async () => {
    const quiet = buildHarness()
    expect(await runReviewMetricsExport(quiet.container)).toEqual({ exported: 0, failed: 0 })

    const exporter = recordingExporter()
    const empty = buildHarness({ reviewMetrics: exporter })
    expect(await runReviewMetricsExport(empty.container)).toEqual({ exported: 0, failed: 0 })
    expect(exporter.pushed).toEqual([])
  })

  it('says on /health whether the export is wired', async () => {
    const wired = buildHarness({ reviewMetrics: recordingExporter() })
    const res = await wired.app.fetch(get('/health'))
    const body = (await res.json()) as { capabilities: { reviewMetricsExport: boolean } }
    expect(body.capabilities.reviewMetricsExport).toBe(true)
  })
})
