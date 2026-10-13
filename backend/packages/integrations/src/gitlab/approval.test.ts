import type { PullRequestAddress } from '@sainte-beuve/kernel'
import { ConflictError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { gitlabApprove, gitlabChangedFiles, gitlabWithdrawApproval } from './approval.js'

const MR: PullRequestAddress = {
  provider: 'gitlab',
  owner: 'acme/platform',
  repo: 'api',
  number: 7,
}

interface Call {
  method: string
  url: string
  body: unknown
}

function scripted(answers: { status?: number; body: unknown }[]): {
  fetchImpl: typeof globalThis.fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const queue = [...answers]
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    const answer = queue.shift() ?? { body: {} }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, calls }
}

describe('gitlabChangedFiles', () => {
  it('counts the lines off each patch and reads the file states', async () => {
    const diffs = [
      {
        old_path: 'a.ts',
        new_path: 'a.ts',
        new_file: false,
        renamed_file: false,
        deleted_file: false,
        diff: '@@ -1,2 +1,2 @@\n-old\n+new\n+more\n context',
      },
      {
        old_path: 'b.md',
        new_path: 'b.md',
        new_file: true,
        renamed_file: false,
        deleted_file: false,
        diff: '+x',
      },
    ]
    const { fetchImpl, calls } = scripted([{ body: diffs }])
    const result = await gitlabChangedFiles(MR, { token: 't', fetchImpl })
    expect(calls[0]?.url).toContain('/projects/acme%2Fplatform%2Fapi/merge_requests/7/diffs')
    expect(result).toEqual({
      truncated: false,
      files: [
        { path: 'a.ts', previousPath: null, status: 'modified', additions: 2, deletions: 1 },
        { path: 'b.md', previousPath: null, status: 'added', additions: 1, deletions: 0 },
      ],
    })
  })
})

describe('gitlabApprove', () => {
  it('approves at the assessed commit and leaves the reason as a note', async () => {
    const { fetchImpl, calls } = scripted([{ body: {} }, { body: {} }])
    await gitlabApprove(MR, { headSha: 'abc', body: 'Within policy.' }, { token: 't', fetchImpl })
    expect(calls.map((call) => [call.method, new URL(call.url).pathname, call.body])).toEqual([
      ['POST', '/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests/7/approve', { sha: 'abc' }],
      [
        'POST',
        '/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests/7/notes',
        { body: 'Within policy.' },
      ],
    ])
  })

  it('reads a moved head as a conflict and leaves no note', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 409, body: { message: 'SHA does not match' } },
    ])
    await expect(
      gitlabApprove(MR, { headSha: 'abc', body: 'x' }, { token: 't', fetchImpl }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(calls).toHaveLength(1)
  })
})

describe('gitlabWithdrawApproval', () => {
  it('unapproves as the token and says why in a note', async () => {
    const { fetchImpl, calls } = scripted([{ body: {} }, { body: {} }])
    await gitlabWithdrawApproval(MR, { message: 'New commits.' }, { token: 't', fetchImpl })
    expect(calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ['POST', '/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests/7/unapprove'],
      ['POST', '/api/v4/projects/acme%2Fplatform%2Fapi/merge_requests/7/notes'],
    ])
  })
})
