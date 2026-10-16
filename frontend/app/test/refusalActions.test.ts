import { describe, expect, it } from 'vitest'
import { refusalActions } from '../app/utils/refusalActions'
import { ApiError } from '../app/utils/sainteBeuveApi'

const missing = new ApiError(503, 'unavailable', 'no cat-factory service backs its repository', {
  reason: 'cat_factory_repository_missing',
  repository: 'kibertoad/simpler-service3',
  provider: 'github',
  addRepositoryUrl: 'http://localhost:8787/?addRepo=kibertoad%2Fsimpler-service3&provider=github',
})

describe('refusalActions', () => {
  it('links a missing repository into cat-factory, then offers the retry', () => {
    const retry = () => {}
    expect(refusalActions(missing, retry)).toEqual([
      {
        label: 'Add kibertoad/simpler-service3 in cat-factory',
        to: 'http://localhost:8787/?addRepo=kibertoad%2Fsimpler-service3&provider=github',
        target: '_blank',
      },
      { label: 'Retry', onClick: retry },
    ])
  })

  it('offers only the link where there is nothing to retry', () => {
    expect(refusalActions(missing)).toHaveLength(1)
  })

  it('offers nothing for any other refusal', () => {
    const other = new ApiError(503, 'unavailable', 'down', { reason: 'something_else' })
    expect(refusalActions(other, () => {})).toEqual([])
    expect(refusalActions(new Error('Failed to fetch'), () => {})).toEqual([])
  })
})
