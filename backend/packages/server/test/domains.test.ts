import type { Org, OrgList, Project } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  PR,
  type TestHarness,
  addReviewer,
  assignReviewer,
  buildHarness,
  get,
  openReview,
  patch,
  post,
} from './helpers.js'

const ORG = '/api/v1/settings/orgs/current'

async function orgDomains(harness: TestHarness): Promise<string[]> {
  const res = await harness.app.fetch(get('/api/v1/settings/orgs'))
  const { orgs } = (await res.json()) as OrgList
  return orgs[0]?.domains ?? []
}

async function register(
  harness: TestHarness,
  domains: string[],
  skills: string[] = [],
): Promise<Project> {
  const res = await harness.app.fetch(
    post('/api/v1/projects', {
      provider: 'github',
      owner: PR.owner,
      repo: PR.repo,
      skills,
      domains,
    }),
  )
  expect(res.status).toBe(201)
  return (await res.json()) as Project
}

describe('domains', () => {
  it("adds a repository's new domains to the org, in the spelling the org already has", async () => {
    const harness = buildHarness()
    const org = await harness.app.fetch(patch(ORG, { domains: ['billing', 'Billing'] }))
    expect(((await org.json()) as Org).domains).toStrictEqual(['billing'])

    const project = await register(harness, ['Billing', 'search'])

    expect(project.domains).toStrictEqual(['billing', 'search'])
    expect(await orgDomains(harness)).toStrictEqual(['billing', 'search'])
  })

  it('does the same when a repository is edited', async () => {
    const harness = buildHarness()
    const project = await register(harness, [])

    const res = await harness.app.fetch(
      patch(`/api/v1/projects/${project.id}`, { domains: ['onboarding'] }),
    )

    expect(((await res.json()) as Project).domains).toStrictEqual(['onboarding'])
    expect(await orgDomains(harness)).toStrictEqual(['onboarding'])
  })

  // Two reviewers at equal weight, drawn at 0.4 of the total. Without domains
  // the first takes the draw; knowing the repository's one domain makes the
  // second's share five times the first's, which moves the same draw onto them.
  it("favours the reviewer who knows the repository's domains", async () => {
    const assigned = async (domains: string[]) => {
      const harness = buildHarness({ random: () => 0.4 })
      await addReviewer(harness, { displayName: 'Generalist', handles: { github: 'gen' } })
      const expert = await addReviewer(harness, {
        displayName: 'Expert',
        handles: { github: 'exp' },
        domains: ['billing'],
      })
      await register(harness, domains)
      const review = await openReview(harness)
      const body = (await (await assignReviewer(harness, review.id)).json()) as {
        assigned: { reviewerId: string }[]
      }
      return body.assigned[0]?.reviewerId === expert.id
    }

    expect(await assigned([])).toBe(false)
    expect(await assigned(['billing'])).toBe(true)
  })

  it("wants the repository's skills when the review asks for none", async () => {
    const harness = buildHarness({ random: () => 0.4 })
    await addReviewer(harness, { displayName: 'Designer', handles: { github: 'des' } })
    const backender = await addReviewer(harness, {
      displayName: 'Backender',
      handles: { github: 'back' },
      skills: ['Backend'],
    })
    await register(harness, [], ['Backend'])
    const review = await openReview(harness)

    const body = (await (await assignReviewer(harness, review.id)).json()) as {
      assigned: { reviewerId: string }[]
    }
    expect(body.assigned[0]?.reviewerId).toBe(backender.id)
  })
})
