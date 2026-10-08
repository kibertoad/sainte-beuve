import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { isWebUrl, projectRefSchema, pullRequestRefSchema, webUrlSchema } from './vcs.js'

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

// Every URL on this wire becomes an `href` somewhere, and `v.url()` alone is
// `new URL()`, which parses a script as readily as a page.
const NOT_LINKS = [
  'javascript:alert(1)',
  'JavaScript:alert(document.cookie)',
  ' javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  '//github.com/kibertoad/sainte-beuve',
  'not a url',
]

describe('webUrlSchema', () => {
  it('accepts an http and an https link, including a self-hosted host', () => {
    expect(v.parse(webUrlSchema, 'https://gitlab.internal:8443/platform/api')).toBe(
      'https://gitlab.internal:8443/platform/api',
    )
    expect(isWebUrl('http://localhost:8787/tasks/1')).toBe(true)
  })

  for (const url of NOT_LINKS) {
    it(`refuses ${JSON.stringify(url)}`, () => {
      expect(() => v.parse(webUrlSchema, url)).toThrow()
      expect(isWebUrl(url.trim())).toBe(false)
    })
  }

  it('is the rule a pull request link is held to', () => {
    expect(() => v.parse(pullRequestRefSchema, { ...PR, url: 'javascript:alert(1)' })).toThrow()
  })
})
