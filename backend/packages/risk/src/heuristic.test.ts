import type { ChangedFile } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { assessChangedFiles } from './heuristic.js'

function file(path: string, additions = 10, deletions = 0): ChangedFile {
  return { path, previousPath: null, status: 'modified', additions, deletions }
}

describe('assessChangedFiles', () => {
  it('scores a small documentation change as low on every axis', () => {
    const { changeClass, scores } = assessChangedFiles([file('docs/guide.md', 20, 4)], false)
    expect(changeClass).toBe('docs')
    expect(scores.complexity).toBeLessThan(0.05)
    expect(scores.risk).toBeLessThan(0.1)
    expect(scores.impact).toBeLessThan(0.1)
  })

  it('scores a lockfile by the manifest, not by the size of the lockfile', () => {
    const { scores } = assessChangedFiles(
      [file('package.json', 1, 1), file('pnpm-lock.yaml', 4000, 3000)],
      false,
    )
    expect(scores.complexity).toBeLessThan(0.1)
  })

  it('raises the risk of code that touches authentication', () => {
    const plain = assessChangedFiles([file('src/report.ts'), file('src/report.test.ts')], false)
    const auth = assessChangedFiles(
      [file('src/auth/session.ts'), file('src/auth/session.test.ts')],
      false,
    )
    expect(auth.scores.risk).toBeGreaterThan(plain.scores.risk)
    expect(auth.rationale).toContain('authentication')
  })

  it('raises the risk of code changed without a test', () => {
    const tested = assessChangedFiles([file('src/a.ts'), file('src/a.test.ts')], false)
    const untested = assessChangedFiles([file('src/a.ts')], false)
    expect(untested.scores.risk).toBeGreaterThan(tested.scores.risk)
  })

  it('grows complexity with the size of the change', () => {
    const small = assessChangedFiles([file('src/a.ts', 10)], false)
    const large = assessChangedFiles([file('src/a.ts', 900), file('src/b.ts', 400)], false)
    expect(large.scores.complexity).toBeGreaterThan(small.scores.complexity)
  })

  it('scores a migration as risky and far-reaching', () => {
    const { changeClass, scores } = assessChangedFiles([file('migrations/0002_users.sql')], false)
    expect(changeClass).toBe('schema')
    expect(scores.risk).toBeGreaterThanOrEqual(0.7)
    expect(scores.impact).toBeGreaterThanOrEqual(0.3)
  })

  it('scores a truncated listing as maximal', () => {
    const { changeClass, scores, rationale } = assessChangedFiles([file('README.md')], true)
    expect(changeClass).toBe('unknown')
    expect(scores).toEqual({ complexity: 1, risk: 1, impact: 1 })
    expect(rationale).toContain('only part')
  })

  it('scores an empty listing as unknown and maximal', () => {
    expect(assessChangedFiles([], false)).toMatchObject({
      changeClass: 'unknown',
      scores: { complexity: 1, risk: 1, impact: 1 },
    })
  })
})
