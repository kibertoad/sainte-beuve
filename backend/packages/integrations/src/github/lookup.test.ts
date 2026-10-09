import { describe, expect, it } from 'vitest'
import { appTokenSource, staticTokenSource } from './credentials.js'
import type { GitHubAppAuth } from './GitHubAppAuth.js'
import { GitHubVcsGateway } from './GitHubVcsGateway.js'

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

describe('GitHubVcsGateway.lookupRepositories', () => {
  it('searches the owner by name once the owner exists', async () => {
    const { fetchImpl, urls } = scripted([
      [200, { login: 'kibertoad' }],
      [200, { items: [{ name: 'sainte-beuve', description: 'Reviews', private: true }] }],
    ])
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    const lookup = await gateway.lookupRepositories('kibertoad', 'sain')

    expect(lookup).toStrictEqual({
      ownerFound: true,
      repositories: [{ repo: 'sainte-beuve', description: 'Reviews', private: true }],
    })
    expect(urls[0]?.pathname).toBe('/users/kibertoad')
    expect(urls[1]?.pathname).toBe('/search/repositories')
    expect(urls[1]?.searchParams.get('q')).toBe('sain in:name user:kibertoad archived:false')
  })

  it('reports an owner GitHub does not know without spending a search', async () => {
    const { fetchImpl, urls } = scripted([[404, { message: 'Not Found' }]])
    const gateway = new GitHubVcsGateway({ tokens: staticTokenSource('ghp_x'), fetchImpl })

    expect(await gateway.lookupRepositories('nobody-here', 'api')).toStrictEqual({
      ownerFound: false,
      repositories: [],
    })
    expect(urls).toHaveLength(1)
  })

  it('answers null under an App, without a request', async () => {
    const { fetchImpl, urls } = scripted([])
    const auth = { tokenForRepo: () => Promise.reject(new Error('not asked')) }
    const gateway = new GitHubVcsGateway({
      tokens: appTokenSource(auth as unknown as GitHubAppAuth),
      fetchImpl,
    })

    expect(await gateway.lookupRepositories('kibertoad', 'sain')).toBeNull()
    expect(urls).toHaveLength(0)
  })
})
