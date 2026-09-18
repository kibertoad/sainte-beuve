import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { projectRefSchema, pullRequestRefSchema } from './vcs.js'

// The two segments that end up interpolated into a host's API path. The cases
// below are the reason the schema is not `v.string()`: `fetch` resolves `..` and
// truncates at `?` before a request leaves the process, so a ref that carries
// either lets whoever sent it pick the path the org's credential is spent on.

const PR = {
  provider: 'github',
  owner: 'kibertoad',
  repo: 'sainte-beuve',
  number: 1,
  url: 'https://github.com/kibertoad/sainte-beuve/pull/1',
}

const INJECTIONS = [
  'x/../../../repos/victim/other/issues/1/comments?',
  '..',
  '.',
  'sainte-beuve?per_page=1',
  'sainte beuve',
  'sainte%2Fbeuve',
  'sainte#beuve',
]

describe('pullRequestRefSchema', () => {
  it('accepts a plain repository', () => {
    expect(v.parse(pullRequestRefSchema, PR).repo).toBe('sainte-beuve')
  })

  it('accepts a repository whose name begins with a dot', () => {
    expect(v.parse(pullRequestRefSchema, { ...PR, repo: '.github' }).repo).toBe('.github')
  })

  for (const repo of INJECTIONS) {
    it(`refuses the repo ${JSON.stringify(repo)}`, () => {
      expect(() => v.parse(pullRequestRefSchema, { ...PR, repo })).toThrow()
    })
  }

  for (const owner of INJECTIONS) {
    it(`refuses the owner ${JSON.stringify(owner)}`, () => {
      expect(() => v.parse(pullRequestRefSchema, { ...PR, owner })).toThrow()
    })
  }
})

describe('projectRefSchema', () => {
  it('accepts a nested GitLab namespace, which is the one place a slash is a name', () => {
    const parsed = v.parse(projectRefSchema, {
      provider: 'gitlab',
      owner: 'platform/backend',
      repo: 'api',
    })
    expect(parsed.owner).toBe('platform/backend')
  })

  it('refuses a namespace with a traversal segment in it', () => {
    expect(() =>
      v.parse(projectRefSchema, { provider: 'gitlab', owner: 'platform/../admin', repo: 'api' }),
    ).toThrow()
  })
})
