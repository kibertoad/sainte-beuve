import assert from 'node:assert/strict'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import { apiKey, session } from './fixtures.js'
import { type TenancyCase, tenancyCase } from './tenancy-cases.js'

/**
 * Sessions and API keys.
 *
 * Every case here is about a credential, which is why they are worth writing out
 * three times rather than trusting one store: the two questions asked on every
 * authenticated request are "which row does this digest address" and "is it over
 * yet", and a store that answered either differently would be a deployment where
 * signing out does not, or where a session outlives its expiry.
 *
 * They take the PROVIDER rather than one org's repositories, because resolving a
 * digest is what DECIDES which org a request is in and therefore cannot be asked
 * of a store already bound to one. `repos` below is the default org's, which is
 * where every write goes; the reads go through `stores.tenancy`, exactly as the
 * authentication middleware does them.
 */
export const sessionCases: readonly TenancyCase[] = [
  tenancyCase('a session comes back whole, by its digest', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    const written = session('s1')
    assert.deepStrictEqual(await repos.sessions.create(written), written)
    assert.deepStrictEqual(await stores.tenancy.findSessionByDigest('digest-s1'), written)
  }),

  tenancyCase('a digest nothing was stored under answers null', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.sessions.create(session('s1'))
    assert.strictEqual(await stores.tenancy.findSessionByDigest('digest-of-nothing'), null)
  }),

  tenancyCase('a digest addresses one session and not its neighbour', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.sessions.create(session('s1', { reviewerId: 'r1' }))
    await repos.sessions.create(session('s2', { reviewerId: 'r2' }))
    assert.strictEqual((await stores.tenancy.findSessionByDigest('digest-s2'))?.reviewerId, 'r2')
  }),

  tenancyCase('touching a session moves only when it was last seen', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.sessions.create(session('s1'))
    await repos.sessions.touch('s1', 5_000)
    const held = await stores.tenancy.findSessionByDigest('digest-s1')
    assert.strictEqual(held?.lastSeenAt, 5_000)
    assert.strictEqual(held?.createdAt, 1_000)
    assert.strictEqual(held?.expiresAt, 100_000)
  }),

  // The row can be swept between the read that resolved a session and the write
  // that records it was used, and a request must not fail for having been slow.
  tenancyCase('touching a session that is gone is not an error', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.sessions.touch('nobody', 5_000)
  }),

  tenancyCase('signing out drops the session and nothing else', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.sessions.create(session('s1'))
    await repos.sessions.create(session('s2'))
    await repos.sessions.delete('s1')
    assert.strictEqual(await stores.tenancy.findSessionByDigest('digest-s1'), null)
    assert.strictEqual((await stores.tenancy.findSessionByDigest('digest-s2'))?.id, 's2')
  }),

  tenancyCase('every session of one person goes at once', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.sessions.create(session('s1', { reviewerId: 'r1' }))
    await repos.sessions.create(session('s2', { reviewerId: 'r1' }))
    await repos.sessions.create(session('s3', { reviewerId: 'r2' }))
    await repos.sessions.deleteForReviewer('r1')
    assert.strictEqual(await stores.tenancy.findSessionByDigest('digest-s1'), null)
    assert.strictEqual(await stores.tenancy.findSessionByDigest('digest-s2'), null)
    assert.strictEqual((await stores.tenancy.findSessionByDigest('digest-s3'))?.id, 's3')
  }),

  tenancyCase('the sweep takes what has expired and counts it', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.sessions.create(session('s1', { expiresAt: 1_500 }))
    // Exactly now counts as over, because that is what the read believes: a
    // store sweeping on `<` would keep a row every caller is refused with.
    await repos.sessions.create(session('s2', { expiresAt: 2_000 }))
    await repos.sessions.create(session('s3', { expiresAt: 9_000 }))
    assert.strictEqual(await repos.sessions.deleteExpired(2_000), 2)
    assert.strictEqual(await stores.tenancy.findSessionByDigest('digest-s1'), null)
    assert.strictEqual(await stores.tenancy.findSessionByDigest('digest-s2'), null)
    assert.strictEqual((await stores.tenancy.findSessionByDigest('digest-s3'))?.id, 's3')
  }),

  tenancyCase('a sweep with nothing to take counts nothing', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.sessions.create(session('s1', { expiresAt: 9_000 }))
    assert.strictEqual(await repos.sessions.deleteExpired(2_000), 0)
  }),
]

export const apiKeyCases: readonly TenancyCase[] = [
  tenancyCase('a key comes back whole, by its digest', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    const written = apiKey('k1')
    assert.deepStrictEqual(await repos.apiKeys.create(written), written)
    assert.deepStrictEqual(await stores.tenancy.findApiKeyByDigest('digest-k1'), written)
  }),

  tenancyCase('a key nobody minted survives the round trip as null', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    // `createdBy` is null for a key no person is behind, and `lastUsedAt` is
    // null until one is presented. A store that turned either into undefined
    // would break the directory that renders them.
    const written = apiKey('k1', { createdBy: null })
    await repos.apiKeys.create(written)
    const held = await stores.tenancy.findApiKeyByDigest('digest-k1')
    assert.strictEqual(held?.createdBy, null)
    assert.strictEqual(held?.lastUsedAt, null)
  }),

  tenancyCase('lists the keys newest first, ties on the id', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.apiKeys.create(apiKey('k2', { createdAt: 2_000 }))
    await repos.apiKeys.create(apiKey('k1', { createdAt: 1_000 }))
    await repos.apiKeys.create(apiKey('k3', { createdAt: 2_000 }))
    assert.deepStrictEqual(
      (await repos.apiKeys.list()).map((row) => row.id),
      ['k3', 'k2', 'k1'],
    )
  }),

  tenancyCase('using a key records when, and nothing else', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.apiKeys.create(apiKey('k1'))
    await repos.apiKeys.touch('k1', 7_000)
    const held = await stores.tenancy.findApiKeyByDigest('digest-k1')
    assert.strictEqual(held?.lastUsedAt, 7_000)
    assert.strictEqual(held?.createdAt, 1_000)
    assert.strictEqual(held?.label, 'key k1')
  }),

  tenancyCase('touching a key that is gone is not an error', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.apiKeys.touch('nobody', 7_000)
  }),

  tenancyCase('a revoked key resolves to nobody', async (stores) => {
    const repos = stores.forOrg(DEFAULT_ORG_ID)
    await repos.apiKeys.create(apiKey('k1'))
    await repos.apiKeys.delete('k1')
    assert.strictEqual(await stores.tenancy.findApiKeyByDigest('digest-k1'), null)
    assert.deepStrictEqual(await repos.apiKeys.list(), [])
  }),
]
