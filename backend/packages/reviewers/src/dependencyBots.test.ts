import { describe, expect, it } from 'vitest'
import { isDependencyBot } from './dependencyBots.js'

describe('isDependencyBot', () => {
  it.each([
    'dependabot[bot]',
    'dependabot-preview[bot]',
    'renovate[bot]',
    'Renovate[bot]',
    'renovate-bot',
    'renovatebot',
    'dependabot',
  ])('matches %s', (login) => {
    expect(isDependencyBot(login)).toBe(true)
  })

  it.each(['github-actions[bot]', 'renovator', 'ada', 'dependabot-fan', 'my-renovate[bot]'])(
    'leaves %s alone',
    (login) => {
      expect(isDependencyBot(login)).toBe(false)
    },
  )
})
