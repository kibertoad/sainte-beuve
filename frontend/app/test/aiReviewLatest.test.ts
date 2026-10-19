import type { LatestAiReviewRun } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { progressLinks, resultsLink } from '../app/utils/aiReviewLatest'

function run(
  runId: string,
  status: LatestAiReviewRun['status'] = 'running',
  requestedAt = 0,
): LatestAiReviewRun {
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
    requestedAt,
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

  it('leaves a completed run to the results link', () => {
    expect(
      progressLinks([run('run-0', 'completed'), run('run-1')]).map((l) => l.key),
    ).toStrictEqual(['run-1'])
  })

  it('offers nothing when no run is in flight', () => {
    expect(progressLinks([])).toStrictEqual([])
  })
})

describe('resultsLink', () => {
  it('opens the latest completed run', () => {
    const link = resultsLink([run('run-1', 'completed', 1), run('run-2', 'completed', 2)])
    expect(link?.to).toBe('/ai-review?review=rev-1&run=run-2')
    expect(link?.label).toBe('AI review results')
  })

  it('offers nothing when no run has completed', () => {
    expect(resultsLink([run('run-1'), run('run-2', 'failed')])).toBeNull()
  })
})
