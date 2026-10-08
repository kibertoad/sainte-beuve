import type { OpenPullRequest, Project } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import {
  decideDirectMerge,
  matchesStatusFilter,
  projectsInScope,
  resolveMergeComments,
  searchesBeyondProjects,
  unlinkedPullRequests,
} from './merging.js'

const QUEUE = { label: 'Queue', body: '/merge' }
const TEAM_QUEUE = { label: 'Team queue', body: '@bot merge' }
const PROJECT_QUEUE = { label: 'Project queue', body: 'bors r+' }

describe('resolveMergeComments', () => {
  it('takes the most specific level that says anything', () => {
    expect(
      resolveMergeComments({ project: [PROJECT_QUEUE], team: [TEAM_QUEUE], org: [QUEUE] }),
    ).toStrictEqual({ comments: [PROJECT_QUEUE], from: 'project' })
    expect(resolveMergeComments({ project: null, team: [TEAM_QUEUE], org: [QUEUE] })).toStrictEqual(
      { comments: [TEAM_QUEUE], from: 'team' },
    )
    expect(resolveMergeComments({ project: null, team: null, org: [QUEUE] })).toStrictEqual({
      comments: [QUEUE],
      from: 'org',
    })
  })

  it('treats an empty override as a decision to have none', () => {
    expect(resolveMergeComments({ project: [], team: [TEAM_QUEUE], org: [QUEUE] })).toStrictEqual({
      comments: [],
      from: 'project',
    })
  })

  it('names no source when nothing is configured anywhere', () => {
    expect(resolveMergeComments({ project: null, team: null, org: [] })).toStrictEqual({
      comments: [],
      from: null,
    })
  })
})

describe('decideDirectMerge', () => {
  const base = {
    mergeability: 'mergeable',
    restrictDirectMerge: false,
    commentsInForce: 1,
  } as const

  it('offers a merge the host would take', () => {
    expect(decideDirectMerge({ ...base, admin: false })).toBe('allowed')
  })

  it('offers nothing the host would refuse, admin or not', () => {
    for (const mergeability of ['blocked', 'conflicting', 'checking', 'draft', null] as const) {
      expect(decideDirectMerge({ ...base, mergeability, admin: true })).toBe('not_mergeable')
    }
  })

  it('restricts a member and lets an admin override when the project restricts', () => {
    const restricted = { ...base, restrictDirectMerge: true }
    expect(decideDirectMerge({ ...restricted, admin: false })).toBe('restricted')
    expect(decideDirectMerge({ ...restricted, admin: true })).toBe('override')
  })

  it('ignores the restriction while no merge comment is in force', () => {
    expect(
      decideDirectMerge({ ...base, restrictDirectMerge: true, commentsInForce: 0, admin: false }),
    ).toBe('allowed')
  })
})

describe('matchesStatusFilter', () => {
  it('files each pull request under exactly one filter', () => {
    const cases = [
      [{ draft: false, approval: 'pending' }, 'awaiting'],
      [{ draft: false, approval: 'changes_requested' }, 'awaiting'],
      [{ draft: false, approval: 'approved' }, 'approved'],
      [{ draft: true, approval: 'approved' }, 'draft'],
      [{ draft: true, approval: 'pending' }, 'draft'],
    ] as const
    for (const [pr, expected] of cases) {
      for (const filter of ['awaiting', 'approved', 'draft'] as const) {
        expect(matchesStatusFilter(filter, pr)).toBe(filter === expected)
      }
    }
  })
})

describe('projectsInScope', () => {
  const project = (id: string, owner: string): Project => ({
    id,
    provider: 'github',
    owner,
    repo: id,
    webUrl: null,
    skills: [],
    mergeComments: null,
    restrictDirectMerge: false,
    createdAt: 1,
  })
  const projects = [project('api', 'Acme'), project('web', 'acme'), project('cli', 'other')]

  it('keeps every project with no filter', () => {
    expect(projectsInScope(projects, {})).toHaveLength(3)
  })

  it('narrows by owner regardless of case, and by project', () => {
    expect(projectsInScope(projects, { owner: 'ACME' }).map((p) => p.id)).toStrictEqual([
      'api',
      'web',
    ])
    expect(projectsInScope(projects, { projectId: 'cli' }).map((p) => p.id)).toStrictEqual(['cli'])
    expect(projectsInScope(projects, { owner: 'acme', projectId: 'cli' })).toStrictEqual([])
  })
})

describe('searchesBeyondProjects', () => {
  it('searches unless the query keeps to the registered projects', () => {
    expect(searchesBeyondProjects({})).toBe(true)
    expect(searchesBeyondProjects({ scope: 'all' })).toBe(true)
    expect(searchesBeyondProjects({ scope: 'linked' })).toBe(false)
    expect(searchesBeyondProjects({ projectId: 'p1' })).toBe(false)
  })
})

describe('unlinkedPullRequests', () => {
  function found(owner: string, repo: string): OpenPullRequest {
    return {
      pullRequest: { provider: 'github', owner, repo, number: 1, url: 'https://x.test/1' },
      title: 'A change',
      authorLogin: 'ada',
      requestedReviewerLogins: [],
      draft: false,
      createdAt: 0,
      updatedAt: 0,
    }
  }

  it('leaves a registered repository to its sweep, whatever its case', () => {
    const projects = [{ provider: 'github' as const, owner: 'acme', repo: 'api' }]
    const rows = unlinkedPullRequests([found('Acme', 'API'), found('acme', 'web')], projects, {})
    expect(rows.map((row) => row.pullRequest.repo)).toStrictEqual(['web'])
  })

  it('keeps to the owner filter', () => {
    const rows = unlinkedPullRequests([found('acme', 'web'), found('other', 'cli')], [], {
      owner: 'ACME',
    })
    expect(rows.map((row) => row.pullRequest.owner)).toStrictEqual(['acme'])
  })
})
