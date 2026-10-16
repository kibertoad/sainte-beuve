import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PERSONAL_PASSWORD_EXPIRY_BUFFER_MS,
  PERSONAL_PASSWORD_TTL_MS,
  cachePassword,
  forgetCachedPassword,
  personalPasswordCacheKey,
  readCachedPassword,
} from '../app/utils/personalPassword'
import { createSainteBeuveApi } from '../app/utils/sainteBeuveApi'

function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  }
}

describe('the cached personal password', () => {
  const key = personalPasswordCacheKey('http://localhost:8788', 'rev-1')

  it('is served until less than the buffer is left, then withheld', () => {
    const storage = memoryStorage()
    cachePassword(storage, key, 'open sesame', 0)
    const lastServed = PERSONAL_PASSWORD_TTL_MS - PERSONAL_PASSWORD_EXPIRY_BUFFER_MS - 1
    expect(readCachedPassword(storage, key, lastServed)).toBe('open sesame')
    expect(readCachedPassword(storage, key, lastServed + 1)).toBeNull()
  })

  it('is one per backend and per person', () => {
    const storage = memoryStorage()
    cachePassword(storage, key, 'open sesame', 0)
    expect(
      readCachedPassword(storage, personalPasswordCacheKey('http://localhost:8788', 'rev-2'), 0),
    ).toBeNull()
    expect(
      readCachedPassword(
        storage,
        personalPasswordCacheKey('https://other.example.com', 'rev-1'),
        0,
      ),
    ).toBeNull()
  })

  it('is gone once forgotten, and an unreadable entry reads as none', () => {
    const storage = memoryStorage()
    cachePassword(storage, key, 'open sesame', 0)
    forgetCachedPassword(storage, key)
    expect(readCachedPassword(storage, key, 0)).toBeNull()
    storage.setItem(key, 'not json')
    expect(readCachedPassword(storage, key, 0)).toBeNull()
  })
})

describe('which calls carry it', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rides only on the calls that file or answer a review', async () => {
    const sent: { url: string; password: string | null }[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}): Promise<Response> => {
      sent.push({
        url: String(url),
        password: new Headers(init.headers).get('x-personal-password'),
      })
      return Promise.resolve(new Response(null, { status: 500 }))
    })
    const api = createSainteBeuveApi('http://localhost:8788', { personalPassword: () => 'pw' })

    const calls = [
      () => api.requestAiReview('r-1'),
      () => api.requestRiskAssessment('r-1'),
      () => api.resumeAiReview('run-1'),
      () => api.getRiskAssessment('r-1'),
      () => api.listReviews(),
    ]
    for (const call of calls) await expect(call()).rejects.toThrow()

    expect(sent.map((call) => [new URL(call.url).pathname, call.password])).toEqual([
      ['/api/v1/reviews/r-1/ai-review', 'pw'],
      ['/api/v1/reviews/r-1/risk-assessment', 'pw'],
      ['/api/v1/ai-review/runs/run-1/resume', 'pw'],
      ['/api/v1/reviews/r-1/risk-assessment', null],
      ['/api/v1/reviews', null],
    ])
  })
})
