import { describe, expect, it } from 'vitest'
import { classifyChangedFiles, classifyChangedPath } from './classify.js'

describe('classifyChangedPath', () => {
  it.each([
    ['db/migrations/0001_init.sql', 'schema'],
    ['src/db/schema.ts', 'schema'],
    ['src/thing.test.ts', 'test'],
    ['tests/helpers.py', 'test'],
    ['pnpm-lock.yaml', 'dependency'],
    ['README.md', 'docs'],
    ['locales/en/messages.json', 'docs'],
    ['.github/workflows/ci.yml', 'config'],
    ['vitest.config.ts', 'config'],
    ['src/server.ts', 'source'],
  ])('reads %s as %s', (path, expected) => {
    expect(classifyChangedPath(path)).toBe(expected)
  })

  it('keeps code under a docs or deploy directory as source', () => {
    expect(classifyChangedPath('docs/scripts/build.ts')).toBe('source')
    expect(classifyChangedPath('deploy/node/src/main.ts')).toBe('source')
  })
})

describe('classifyChangedFiles', () => {
  it('takes the riskiest class present', () => {
    expect(classifyChangedFiles(['README.md', 'src/a.ts', 'docs/b.md'])).toEqual({
      changeClass: 'source',
      fileCount: 3,
    })
  })

  it('answers unknown for no files', () => {
    expect(classifyChangedFiles(['', ' '])).toEqual({ changeClass: 'unknown', fileCount: 0 })
  })
})
