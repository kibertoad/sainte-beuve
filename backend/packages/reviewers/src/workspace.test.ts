import type { OpenPullRequest, VcsHandles } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { partitionForViewer } from './workspace.js'

/** The viewer, known by a different name on each host. */
const HANDLES: VcsHandles = { github: 'kibertoad', gitlab: 'igor.savin' }

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

    const result = partitionForViewer([mine, forMe, neither], HANDLES)

    expect(result.authored).toStrictEqual([mine])
    expect(result.reviewRequested).toStrictEqual([forMe])
  })

  it('matches a handle however the host spelled it', () => {
    const mine = pr({ authorLogin: 'Kibertoad' })
    expect(partitionForViewer([mine], HANDLES).authored).toStrictEqual([mine])
  })

  it('matches each host by the handle the viewer holds there', () => {
    // The same person on two hosts, under two names.
    const onGitLab = pr({
      pullRequest: { ...pr().pullRequest, provider: 'gitlab' },
      authorLogin: 'igor.savin',
    })
    const onGitHub = pr({ authorLogin: 'kibertoad' })
    const result = partitionForViewer([onGitLab, onGitHub], HANDLES)
    expect(result.authored).toHaveLength(2)
  })

  it('does not hand the viewer a stranger who holds their other host name', () => {
    // A GitHub account called `igor.savin` belongs to somebody else: the
    // viewer's GitLab name says nothing about who that is.
    const stranger = pr({ authorLogin: 'igor.savin' })
    const addressed = pr({ authorLogin: 'peer', requestedReviewerLogins: ['igor.savin'] })

    const result = partitionForViewer([stranger, addressed], HANDLES)

    expect(result.authored).toStrictEqual([])
    expect(result.reviewRequested).toStrictEqual([])
  })

  it('shows nothing from a host the viewer has no handle on', () => {
    const onGitLab = pr({
      pullRequest: { ...pr().pullRequest, provider: 'gitlab' },
      authorLogin: 'igor.savin',
    })
    const result = partitionForViewer([onGitLab], { github: 'kibertoad', gitlab: null })
    expect(result.authored).toStrictEqual([])
  })

  it('keeps a pull request the viewer both opened and was asked to review in one list', () => {
    const both = pr({ authorLogin: 'kibertoad', requestedReviewerLogins: ['kibertoad'] })
    const result = partitionForViewer([both], HANDLES)
    expect(result.authored).toStrictEqual([both])
    expect(result.reviewRequested).toStrictEqual([])
  })

  it('puts what moved most recently at the top', () => {
    const old = pr({ authorLogin: 'kibertoad', updatedAt: 10 })
    const fresh = pr({ authorLogin: 'kibertoad', updatedAt: 20 })
    expect(partitionForViewer([old, fresh], HANDLES).authored).toStrictEqual([fresh, old])
  })

  it('shows nothing to a viewer with no handles at all', () => {
    const result = partitionForViewer([pr({ authorLogin: 'kibertoad' })], {
      github: null,
      gitlab: null,
    })
    expect(result.authored).toStrictEqual([])
    expect(result.reviewRequested).toStrictEqual([])
  })
})
