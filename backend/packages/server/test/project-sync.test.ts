import type { ExternalRepository, Project } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { planProjectSync } from '../src/modules/projects/projectSync.js'

function project(id: string, repo: string, external?: Project['external']): Project {
  return {
    id,
    provider: 'github',
    owner: 'acme',
    repo,
    webUrl: null,
    skills: [],
    domains: [],
    mergeComments: null,
    restrictDirectMerge: false,
    ...(external === undefined ? {} : { external }),
    createdAt: 1,
  }
}

function listed(key: string, repo: string, id: string, source = 'cat-factory'): ExternalRepository {
  return { source, key, seq: 1, repository: { provider: 'github', owner: 'acme', repo, id } }
}

describe('planProjectSync', () => {
  it('creates one project for a repository listed under two keys', () => {
    const plan = planProjectSync(
      'cat-factory',
      [],
      [listed('ws_1/7', 'payments', '7'), listed('ws_2/7', 'payments', '7')],
    )
    expect(plan.create).toEqual([
      {
        provider: 'github',
        owner: 'acme',
        repo: 'payments',
        external: { source: 'cat-factory', id: '7' },
      },
    ])
  })

  it('renames by the source id rather than recreating', () => {
    const plan = planProjectSync(
      'cat-factory',
      [project('p1', 'payments', { source: 'cat-factory', id: '7' })],
      [listed('ws_1/7', 'payments-api', '7')],
    )
    expect(plan).toEqual({
      remove: [],
      rename: [{ projectId: 'p1', owner: 'acme', repo: 'payments-api' }],
      adopt: [],
      create: [],
    })
  })

  it('creates no second project for a name already held under another id', () => {
    const plan = planProjectSync(
      'cat-factory',
      [project('p1', 'payments', { source: 'cat-factory', id: '7' })],
      [listed('ws_1/7', 'payments', '7'), listed('ws_2/9', 'payments', '9')],
    )
    expect(plan).toEqual({ remove: [], rename: [], adopt: [], create: [] })
  })

  it('ignores a dropped entry, and a case-only difference in the name', () => {
    const plan = planProjectSync(
      'cat-factory',
      [project('p1', 'Payments', { source: 'cat-factory', id: '7' })],
      [listed('ws_1/7', 'payments', '7'), { ...listed('ws_1/8', 'gone', '8'), repository: null }],
    )
    expect(plan).toEqual({ remove: [], rename: [], adopt: [], create: [] })
  })

  it('adopts a local project the source lists, removes the rest, and leaves other sources alone', () => {
    const plan = planProjectSync(
      'cat-factory',
      [
        project('p1', 'payments'),
        project('p2', 'legacy'),
        project('p3', 'elsewhere', { source: 'other', id: '9' }),
        project('p4', 'unlinked', { source: 'cat-factory', id: '4' }),
      ],
      [listed('ws_1/7', 'payments', '7')],
    )
    expect(plan).toEqual({
      remove: ['p4', 'p2'],
      rename: [],
      adopt: [{ projectId: 'p1', external: { source: 'cat-factory', id: '7' } }],
      create: [],
    })
  })
})
