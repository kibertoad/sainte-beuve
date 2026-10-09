import { describe, expect, it } from 'vitest'
import { GitLabVcsGateway } from './GitLabVcsGateway.js'

/** Answers each call from a queue of `[status, body]`, recording the URLs asked for. */
function scripted(answers: [number, unknown][]): {
  fetchImpl: typeof globalThis.fetch
  urls: URL[]
} {
  const urls: URL[] = []
  const queue = [...answers]
  const fetchImpl = (async (url: string | URL | Request) => {
    urls.push(new URL(String(url)))
    const [status, body] = queue.shift() ?? [200, {}]
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetchImpl, urls }
}

describe('GitLabVcsGateway.lookupRepositories', () => {
  it('lists a nested group by its namespace id', async () => {
    const { fetchImpl, urls } = scripted([
      [200, { id: 42, kind: 'group' }],
      [200, [{ path: 'api', description: null, visibility: 'internal' }]],
    ])
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })

    const lookup = await gateway.lookupRepositories('platform/backend', 'api')

    expect(lookup).toStrictEqual({
      ownerFound: true,
      repositories: [{ repo: 'api', description: null, private: true }],
    })
    expect(String(urls[0])).toContain('/api/v4/namespaces/platform%2Fbackend')
    expect(urls[1]?.pathname).toBe('/api/v4/groups/42/projects')
    expect(urls[1]?.searchParams.get('search')).toBe('api')
  })

  it("lists a user's projects under the users resource", async () => {
    const { fetchImpl, urls } = scripted([
      [200, { id: 7, kind: 'user' }],
      [200, []],
    ])
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })

    await gateway.lookupRepositories('ada', 'tools')

    expect(urls[1]?.pathname).toBe('/api/v4/users/7/projects')
  })

  it('reports a namespace GitLab does not know', async () => {
    const { fetchImpl, urls } = scripted([[404, { message: '404 Namespace Not Found' }]])
    const gateway = new GitLabVcsGateway({ token: 'glpat-x', fetchImpl })

    expect(await gateway.lookupRepositories('nobody', 'api')).toStrictEqual({
      ownerFound: false,
      repositories: [],
    })
    expect(urls).toHaveLength(1)
  })
})
