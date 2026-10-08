import type { MyPullRequest, PullRequestStatus } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { cleanMergeComments, mergeStateLabel } from '../app/utils/mergeComments'

describe('cleanMergeComments', () => {
  it('trims each row and drops one left entirely blank', () => {
    expect(
      cleanMergeComments([
        { label: ' Queue ', body: ' /merge ' },
        { label: ' ', body: '' },
      ]),
    ).toStrictEqual([{ label: 'Queue', body: '/merge' }])
  })

  it('keeps null, which inherits the level above', () => {
    expect(cleanMergeComments(null)).toBeNull()
  })
})

describe('mergeStateLabel', () => {
  function row(status: Partial<PullRequestStatus> | null): MyPullRequest {
    return {
      status:
        status === null
          ? null
          : {
              state: 'open',
              url: 'https://github.com/acme/api/pull/1',
              authorLogin: 'ada',
              draft: false,
              approval: 'pending',
              mergeability: 'mergeable',
              headSha: 'sha',
              ...status,
            },
    } as MyPullRequest
  }

  it('puts a change request ahead of whatever the host would merge', () => {
    expect(mergeStateLabel(row({ approval: 'changes_requested' })).label).toBe('Changes requested')
  })

  it('names each merge state', () => {
    expect(mergeStateLabel(row({})).label).toBe('Ready to merge')
    expect(mergeStateLabel(row({ mergeability: 'blocked' })).label).toBe('Blocked')
    expect(mergeStateLabel(row({ mergeability: 'conflicting' })).label).toBe('Has conflicts')
    expect(mergeStateLabel(row(null)).label).toBe('Status unknown')
  })
})
