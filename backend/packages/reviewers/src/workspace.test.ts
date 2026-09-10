import type { OpenPullRequest } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { partitionForViewer } from './workspace.js'

function pr(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    pullRequest: {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 1,
      url: 'https://github.com/kibertoad/sainte-beuve/pull/1',
    },
    title: 'A change',
    authorLogin: 'someone',
    requestedReviewerLogins: [],
    draft: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('partitionForViewer', () => {
  it('splits by the part the viewer plays', () => {
    const mine = pr({ authorLogin: 'kibertoad' })
    const forMe = pr({ authorLogin: 'peer', requestedReviewerLogins: ['kibertoad'] })
    const neither = pr({ authorLogin: 'peer', requestedReviewerLogins: ['other'] })

    const result = partitionForViewer([mine, forMe, neither], ['kibertoad'])

    expect(result.authored).toStrictEqual([mine])
    expect(result.reviewRequested).toStrictEqual([forMe])
  })

  it('matches a handle however the host spelled it', () => {
    const mine = pr({ authorLogin: 'Kibertoad' })
    expect(partitionForViewer([mine], ['kibertoad']).authored).toStrictEqual([mine])
  })

  it('matches any of the handles the viewer is known by', () => {
    // The same person on two hosts, under two names.
    const onGitLab = pr({ authorLogin: 'igor.savin' })
    const onGitHub = pr({ authorLogin: 'kibertoad' })
    const result = partitionForViewer([onGitLab, onGitHub], ['kibertoad', 'igor.savin'])
    expect(result.authored).toHaveLength(2)
  })

  it('keeps a pull request the viewer both opened and was asked to review in one list', () => {
    const both = pr({ authorLogin: 'kibertoad', requestedReviewerLogins: ['kibertoad'] })
    const result = partitionForViewer([both], ['kibertoad'])
    expect(result.authored).toStrictEqual([both])
    expect(result.reviewRequested).toStrictEqual([])
  })

  it('puts what moved most recently at the top', () => {
    const old = pr({ authorLogin: 'kibertoad', updatedAt: 10 })
    const fresh = pr({ authorLogin: 'kibertoad', updatedAt: 20 })
    expect(partitionForViewer([old, fresh], ['kibertoad']).authored).toStrictEqual([fresh, old])
  })

  it('shows nothing to a viewer with no handles at all', () => {
    const result = partitionForViewer([pr({ authorLogin: 'kibertoad' })], [])
    expect(result.authored).toStrictEqual([])
    expect(result.reviewRequested).toStrictEqual([])
  })
})
