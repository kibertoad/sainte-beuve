import type { AiReviewInFlight } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { progressLinks } from '../app/utils/aiReviewInFlight'

function run(runId: string, status: AiReviewInFlight['status'] = 'running'): AiReviewInFlight {
  return {
    pullRequest: {
      provider: 'github',
      owner: 'lokalise',
      repo: 'ota-service',
      number: 1159,
      url: 'https://github.com/lokalise/ota-service/pull/1159',
    },
    reviewId: 'rev-1',
    runId,
    status,
    requestedAt: 0,
  }
}

describe('progressLinks', () => {
  it('opens the review screen on the one run in flight', () => {
    expect(progressLinks([run('run-1', 'awaiting_selection')])).toStrictEqual([
      {
        key: 'run-1',
        label: 'AI review progress',
        to: '/ai-review?review=rev-1&run=run-1',
        title: 'The AI review is waiting on you',
      },
    ])
  })

  it('offers one button per run, numbered', () => {
    expect(progressLinks([run('run-1'), run('run-2')]).map((link) => link.label)).toStrictEqual([
      'AI review progress (1/2)',
      'AI review progress (2/2)',
    ])
  })

  it('offers nothing when no run is in flight', () => {
    expect(progressLinks([])).toStrictEqual([])
  })
})
