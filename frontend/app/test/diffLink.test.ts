import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { filesChangedHref } from '../app/utils/diffLink'

const PATH = 'src/app/poll.ts'
const sha256 = createHash('sha256').update(PATH).digest('hex')
const sha1 = createHash('sha1').update(PATH).digest('hex')

const github = { provider: 'github' as const, url: 'https://github.com/acme/api/pull/42' }
const gitlab = {
  provider: 'gitlab' as const,
  url: 'https://gitlab.example.com/acme/api/-/merge_requests/7',
}

describe('filesChangedHref', () => {
  it('links a GitHub finding to its line on the new side', async () => {
    expect(await filesChangedHref(github, { path: PATH, line: 12, side: 'RIGHT' })).toBe(
      `https://github.com/acme/api/pull/42/files#diff-${sha256}R12`,
    )
  })

  it('links a GitHub finding on the base side with an L line', async () => {
    expect(await filesChangedHref(github, { path: PATH, line: 3, side: 'LEFT' })).toBe(
      `https://github.com/acme/api/pull/42/files#diff-${sha256}L3`,
    )
  })

  it('reads a finding with a line and no side as the new side', async () => {
    expect(await filesChangedHref(github, { path: PATH, line: 5, side: null })).toBe(
      `https://github.com/acme/api/pull/42/files#diff-${sha256}R5`,
    )
  })

  it('links a file-level GitHub finding to the file', async () => {
    expect(await filesChangedHref(github, { path: PATH, line: null, side: null })).toBe(
      `https://github.com/acme/api/pull/42/files#diff-${sha256}`,
    )
  })

  it('drops a trailing slash, query and fragment from the pull request URL', async () => {
    const url = 'https://github.com/acme/api/pull/42/?tab=files#top'
    expect(await filesChangedHref({ ...github, url }, { path: PATH, line: null, side: null })).toBe(
      `https://github.com/acme/api/pull/42/files#diff-${sha256}`,
    )
  })

  it('links a GitLab finding to its file, line or not', async () => {
    const expected = `https://gitlab.example.com/acme/api/-/merge_requests/7/diffs#${sha1}`
    expect(await filesChangedHref(gitlab, { path: PATH, line: 12, side: 'RIGHT' })).toBe(expected)
    expect(await filesChangedHref(gitlab, { path: PATH, line: null, side: null })).toBe(expected)
  })

  it('refuses a URL that is not a web URL', async () => {
    const url = 'javascript:alert(1)'
    expect(await filesChangedHref({ ...github, url }, { path: PATH, line: 1, side: 'RIGHT' })).toBe(
      null,
    )
  })
})
