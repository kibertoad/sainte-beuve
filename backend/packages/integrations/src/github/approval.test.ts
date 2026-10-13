import type { PullRequestAddress } from '@sainte-beuve/kernel'
import { ConflictError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { githubApprove, githubChangedFiles, githubWithdrawApproval } from './approval.js'

const PR: PullRequestAddress = { provider: 'github', owner: 'acme', repo: 'api', number: 7 }

interface Call {
  method: string
  url: string
  body: unknown
}

/** Answers each call from a queue, recording what was asked. */
function scripted(answers: unknown[]): { fetchImpl: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = []
  const queue = [...answers]
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    return new Response(JSON.stringify(queue.shift() ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, calls }
}

function files(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    filename: `src/file${index}.ts`,
    status: 'modified',
    additions: 2,
    deletions: 1,
  }))
}

describe('githubChangedFiles', () => {
  it('reads every page until a short one', async () => {
    const { fetchImpl, calls } = scripted([files(100), files(3)])
    const result = await githubChangedFiles(PR, { token: 't', fetchImpl })
    expect(result.files).toHaveLength(103)
    expect(result.truncated).toBe(false)
    expect(calls[1]?.url).toContain('/repos/acme/api/pulls/7/files?per_page=100&page=2')
  })

  it('maps a rename with its previous path', async () => {
    const renamed = [
      {
        filename: 'b.ts',
        previous_filename: 'a.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
      },
    ]
    const { fetchImpl } = scripted([renamed])
    const { files: listed } = await githubChangedFiles(PR, { token: 't', fetchImpl })
    expect(listed).toEqual([
      { path: 'b.ts', previousPath: 'a.ts', status: 'renamed', additions: 0, deletions: 0 },
    ])
  })
})

describe('githubApprove', () => {
  it('submits an APPROVE review pinned to the assessed commit', async () => {
    const { fetchImpl, calls } = scripted([{ head: { sha: 'abc' } }, { id: 9001 }])
    const approval = await githubApprove(
      PR,
      { headSha: 'abc', body: 'Within policy.' },
      { token: 't', fetchImpl },
    )
    expect(approval).toEqual({ approvalId: '9001', bodyPosted: true })
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'https://api.github.com/repos/acme/api/pulls/7/reviews',
      body: { commit_id: 'abc', event: 'APPROVE', body: 'Within policy.' },
    })
  })

  it('refuses when the head moved after the assessment, approving nothing', async () => {
    const { fetchImpl, calls } = scripted([{ head: { sha: 'def' } }])
    await expect(
      githubApprove(PR, { headSha: 'abc', body: 'x' }, { token: 't', fetchImpl }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(calls).toHaveLength(1)
  })
})

describe('githubWithdrawApproval', () => {
  it('dismisses the approval by its review id', async () => {
    const { fetchImpl, calls } = scripted([{}])
    await githubWithdrawApproval(
      PR,
      { approvalId: '9001', message: 'New commits.' },
      { token: 't', fetchImpl },
    )
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: 'https://api.github.com/repos/acme/api/pulls/7/reviews/9001/dismissals',
      body: { message: 'New commits.', event: 'DISMISS' },
    })
  })
})
