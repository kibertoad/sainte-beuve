import assert from 'node:assert/strict'
import { type ConformanceCase, conformanceCase } from './case.js'
import { apiKey, session } from './fixtures.js'

/**
 * Sessions and API keys.
 *
 * Every case here is about a credential, which is why they are worth writing out
 * three times rather than trusting one store: the two questions asked on every
 * authenticated request are "which row does this digest address" and "is it over
 * yet", and a store that answered either differently would be a deployment where
 * signing out does not, or where a session outlives its expiry.
 */
export const sessionCases: readonly ConformanceCase[] = [
  conformanceCase('a session comes back whole, by its digest', async (repos) => {
    const written = session('s1')
    assert.deepStrictEqual(await repos.sessions.create(written), written)
    assert.deepStrictEqual(await repos.sessions.findByDigest('digest-s1'), written)
  }),

  conformanceCase('a digest nothing was stored under answers null', async (repos) => {
    await repos.sessions.create(session('s1'))
    assert.strictEqual(await repos.sessions.findByDigest('digest-of-nothing'), null)
  }),

  conformanceCase('a digest addresses one session and not its neighbour', async (repos) => {
    await repos.sessions.create(session('s1', { reviewerId: 'r1' }))
    await repos.sessions.create(session('s2', { reviewerId: 'r2' }))
    assert.strictEqual((await repos.sessions.findByDigest('digest-s2'))?.reviewerId, 'r2')
  }),

  conformanceCase('touching a session moves only when it was last seen', async (repos) => {
    await repos.sessions.create(session('s1'))
    await repos.sessions.touch('s1', 5_000)
    const held = await repos.sessions.findByDigest('digest-s1')
    assert.strictEqual(held?.lastSeenAt, 5_000)
    assert.strictEqual(held?.createdAt, 1_000)
    assert.strictEqual(held?.expiresAt, 100_000)
  }),

  // The row can be swept between the read that resolved a session and the write
  // that records it was used, and a request must not fail for having been slow.
  conformanceCase('touching a session that is gone is not an error', async (repos) => {
    await repos.sessions.touch('nobody', 5_000)
  }),

  conformanceCase('signing out drops the session and nothing else', async (repos) => {
    await repos.sessions.create(session('s1'))
    await repos.sessions.create(session('s2'))
    await repos.sessions.delete('s1')
    assert.strictEqual(await repos.sessions.findByDigest('digest-s1'), null)
    assert.strictEqual((await repos.sessions.findByDigest('digest-s2'))?.id, 's2')
  }),

  conformanceCase('every session of one person goes at once', async (repos) => {
    await repos.sessions.create(session('s1', { reviewerId: 'r1' }))
    await repos.sessions.create(session('s2', { reviewerId: 'r1' }))
    await repos.sessions.create(session('s3', { reviewerId: 'r2' }))
    await repos.sessions.deleteForReviewer('r1')
    assert.strictEqual(await repos.sessions.findByDigest('digest-s1'), null)
    assert.strictEqual(await repos.sessions.findByDigest('digest-s2'), null)
    assert.strictEqual((await repos.sessions.findByDigest('digest-s3'))?.id, 's3')
  }),

  conformanceCase('the sweep takes what has expired and counts it', async (repos) => {
    await repos.sessions.create(session('s1', { expiresAt: 1_500 }))
    // Exactly now counts as over, because that is what the read believes: a
    // store sweeping on `<` would keep a row every caller is refused with.
    await repos.sessions.create(session('s2', { expiresAt: 2_000 }))
    await repos.sessions.create(session('s3', { expiresAt: 9_000 }))
    assert.strictEqual(await repos.sessions.deleteExpired(2_000), 2)
    assert.strictEqual(await repos.sessions.findByDigest('digest-s1'), null)
    assert.strictEqual(await repos.sessions.findByDigest('digest-s2'), null)
    assert.strictEqual((await repos.sessions.findByDigest('digest-s3'))?.id, 's3')
  }),

  conformanceCase('a sweep with nothing to take counts nothing', async (repos) => {
    await repos.sessions.create(session('s1', { expiresAt: 9_000 }))
    assert.strictEqual(await repos.sessions.deleteExpired(2_000), 0)
  }),
]

export const apiKeyCases: readonly ConformanceCase[] = [
  conformanceCase('a key comes back whole, by its digest', async (repos) => {
    const written = apiKey('k1')
    assert.deepStrictEqual(await repos.apiKeys.create(written), written)
    assert.deepStrictEqual(await repos.apiKeys.findByDigest('digest-k1'), written)
  }),

  conformanceCase('a key nobody minted survives the round trip as null', async (repos) => {
    // `createdBy` is null for a key no person is behind, and `lastUsedAt` is
    // null until one is presented. A store that turned either into undefined
    // would break the directory that renders them.
    const written = apiKey('k1', { createdBy: null })
    await repos.apiKeys.create(written)
    const held = await repos.apiKeys.findByDigest('digest-k1')
    assert.strictEqual(held?.createdBy, null)
    assert.strictEqual(held?.lastUsedAt, null)
  }),

  conformanceCase('lists the keys newest first, ties on the id', async (repos) => {
    await repos.apiKeys.create(apiKey('k2', { createdAt: 2_000 }))
    await repos.apiKeys.create(apiKey('k1', { createdAt: 1_000 }))
    await repos.apiKeys.create(apiKey('k3', { createdAt: 2_000 }))
    assert.deepStrictEqual(
      (await repos.apiKeys.list()).map((row) => row.id),
      ['k3', 'k2', 'k1'],
    )
  }),

  conformanceCase('using a key records when, and nothing else', async (repos) => {
    await repos.apiKeys.create(apiKey('k1'))
    await repos.apiKeys.touch('k1', 7_000)
    const held = await repos.apiKeys.findByDigest('digest-k1')
    assert.strictEqual(held?.lastUsedAt, 7_000)
    assert.strictEqual(held?.createdAt, 1_000)
    assert.strictEqual(held?.label, 'key k1')
  }),

  conformanceCase('touching a key that is gone is not an error', async (repos) => {
    await repos.apiKeys.touch('nobody', 7_000)
  }),

  conformanceCase('a revoked key resolves to nobody', async (repos) => {
    await repos.apiKeys.create(apiKey('k1'))
    await repos.apiKeys.delete('k1')
    assert.strictEqual(await repos.apiKeys.findByDigest('digest-k1'), null)
    assert.deepStrictEqual(await repos.apiKeys.list(), [])
  }),
]
