import { describe, expect, it } from 'vitest'
import {
  PERSONAL_PASSWORD_EXPIRY_BUFFER_MS,
  PERSONAL_PASSWORD_TTL_MS,
  cachePassword,
  forgetCachedPassword,
  personalPasswordCacheKey,
  readCachedPassword,
  sendsPersonalPassword,
} from '../app/utils/personalPassword'

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
  it('rides only on the calls that file or answer a review', () => {
    const api = 'http://localhost:8788/api/v1'
    expect(sendsPersonalPassword(`${api}/ai-review`, 'POST')).toBe(true)
    expect(sendsPersonalPassword(`${api}/reviews/r-1/ai-review`, 'POST')).toBe(true)
    expect(sendsPersonalPassword(`${api}/ai-review/runs/run-1/resolve`, 'POST')).toBe(true)
    expect(sendsPersonalPassword(`${api}/my-pull-requests/resolve-conflicts`, 'POST')).toBe(true)
    expect(sendsPersonalPassword(`${api}/reviews/r-1/ai-review`, 'GET')).toBe(false)
    expect(sendsPersonalPassword(`${api}/reviews`, 'POST')).toBe(false)
  })
})
