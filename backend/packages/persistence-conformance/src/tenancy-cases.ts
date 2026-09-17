import assert from 'node:assert/strict'
import type { PersistenceProvider } from '@sainte-beuve/kernel'
import {
  aiReviewRun,
  apiKey,
  attentionRequest,
  commitment,
  identity,
  integrationToken,
  org,
  project,
  reminder,
  reviewer,
  review,
  session,
} from './fixtures.js'

/**
 * The org boundary, asserted against every store.
 *
 * These cases take the PROVIDER rather than one org's repositories, because what
 * they are about is the seam between two of them. Everything else in this
 * package is written against `Repositories` and can say nothing about tenancy:
 * a store bound to an org has no method that would reach outside it, which is
 * the design, and therefore also the reason the boundary needs a suite of its
 * own.
 *
 * The three implementations reach isolation differently — the in-memory store
 * gives each org its own maps, and the two durable ones put `org_id` in every
 * primary key and every predicate — so this list is the only thing that says
 * they mean the same. Every case writes the SAME ids in both orgs, which is
 * what makes it a boundary test rather than a test that two id spaces do not
 * happen to collide.
 */
const ORG_A = 'org-a'
const ORG_B = 'org-b'

export const tenancyConformanceCases: readonly TenancyCase[] = [
  tenancyCase('a reviewer belongs to one org and is invisible in the other', async (stores) => {
    await stores.forOrg(ORG_A).reviewers.create(reviewer('r1', { displayName: 'Ada' }))
    await stores.forOrg(ORG_B).reviewers.create(reviewer('r1', { displayName: 'Grace' }))
    assert.strictEqual((await stores.forOrg(ORG_A).reviewers.getById('r1'))?.displayName, 'Ada')
    assert.strictEqual((await stores.forOrg(ORG_B).reviewers.getById('r1'))?.displayName, 'Grace')
    assert.deepStrictEqual(
      (await stores.forOrg(ORG_A).reviewers.list()).map((row) => row.displayName),
      ['Ada'],
    )
  }),

  tenancyCase('an org that has written nothing reads empty rather than failing', async (stores) => {
    await stores.forOrg(ORG_A).reviewers.create(reviewer('r1'))
    assert.deepStrictEqual(await stores.forOrg('org-nobody-made').reviewers.list(), [])
    assert.strictEqual(await stores.forOrg('org-nobody-made').reviewers.getById('r1'), null)
  }),

  tenancyCase('the outstanding counter moves in one org only', async (stores) => {
    await stores.forOrg(ORG_A).reviewers.create(reviewer('r1'))
    await stores.forOrg(ORG_B).reviewers.create(reviewer('r1'))
    await stores.forOrg(ORG_A).reviewers.adjustOutstanding('r1', 2)
    assert.strictEqual((await stores.forOrg(ORG_A).reviewers.getById('r1'))?.outstandingReviews, 2)
    assert.strictEqual((await stores.forOrg(ORG_B).reviewers.getById('r1'))?.outstandingReviews, 0)
  }),

  // The lookup a webhook replay makes. It matches on the pull request rather
  // than on an id, so it is the read most likely to reach across a boundary.
  tenancyCase('two orgs can each hold a review of the same pull request', async (stores) => {
    await stores.forOrg(ORG_A).reviews.create(review('rev1', { title: 'A' }))
    await stores.forOrg(ORG_B).reviews.create(review('rev1', { title: 'B' }))
    const ref = { owner: 'platform', repo: 'api', number: 12 }
    assert.strictEqual((await stores.forOrg(ORG_A).reviews.getByPullRequest(ref))?.title, 'A')
    assert.strictEqual((await stores.forOrg(ORG_B).reviews.getByPullRequest(ref))?.title, 'B')
  }),

  tenancyCase('the reminder tick of one org does not see the other', async (stores) => {
    await stores.forOrg(ORG_A).reminders.create(reminder('n1', { dueAt: 500 }))
    await stores.forOrg(ORG_B).reminders.create(reminder('n1', { dueAt: 500 }))
    await stores.forOrg(ORG_B).reminders.cancelScheduledForReview('review-1')
    assert.strictEqual((await stores.forOrg(ORG_A).reminders.listDue(1_000, 10)).length, 1)
    assert.strictEqual((await stores.forOrg(ORG_B).reminders.listDue(1_000, 10)).length, 0)
  }),

  tenancyCase('AI runs are read back inside the org that filed them', async (stores) => {
    await stores.forOrg(ORG_A).aiReviewRuns.create(aiReviewRun('run1', { summary: 'A' }))
    await stores.forOrg(ORG_B).aiReviewRuns.create(aiReviewRun('run1', { summary: 'B' }))
    assert.strictEqual((await stores.forOrg(ORG_A).aiReviewRuns.getById('run1'))?.summary, 'A')
    assert.deepStrictEqual(
      (await stores.forOrg(ORG_B).aiReviewRuns.listByReview('review-1')).map((run) => run.summary),
      ['B'],
    )
  }),

  // Each org connects its own GitHub: a credential shared across the boundary
  // would let one tenancy's board write comments as another tenancy's bot.
  tenancyCase('a sealed credential belongs to the org that stored it', async (stores) => {
    await stores.forOrg(ORG_A).integrationTokens.put(integrationToken('github', { hint: 'aaaa' }))
    await stores.forOrg(ORG_B).integrationTokens.put(integrationToken('github', { hint: 'bbbb' }))
    assert.strictEqual((await stores.forOrg(ORG_A).integrationTokens.get('github'))?.hint, 'aaaa')
    await stores.forOrg(ORG_A).integrationTokens.delete('github')
    assert.strictEqual(await stores.forOrg(ORG_A).integrationTokens.get('github'), null)
    assert.strictEqual((await stores.forOrg(ORG_B).integrationTokens.get('github'))?.hint, 'bbbb')
  }),

  // A repository is registered once PER ORG. Two tenancies watching one
  // repository is the ordinary multi-tenant case rather than a duplicate.
  tenancyCase('the same repository can be registered in two orgs', async (stores) => {
    await stores.forOrg(ORG_A).projects.create(project('p1'))
    await stores.forOrg(ORG_B).projects.create(project('p2'))
    const ref = { provider: 'github', owner: 'platform', repo: 'api' }
    assert.strictEqual((await stores.forOrg(ORG_A).projects.getByRef(ref))?.id, 'p1')
    assert.strictEqual((await stores.forOrg(ORG_B).projects.getByRef(ref))?.id, 'p2')
  }),

  // What an inbound delivery has instead of a credential: registering a
  // repository is a tenancy claiming responsibility for it.
  tenancyCase('a registered repository names the org an intake lands in', async (stores) => {
    const ref = { provider: 'github', owner: 'platform', repo: 'api' }
    assert.strictEqual(await stores.tenancy.findOrgIdForProject(ref), null)
    await stores.forOrg(ORG_B).projects.create(project('p1'))
    assert.strictEqual(await stores.tenancy.findOrgIdForProject(ref), ORG_B)
    assert.strictEqual(
      await stores.tenancy.findOrgIdForProject({ ...ref, repo: 'nothing-registered' }),
      null,
    )
  }),

  // Which of two claims wins has to be the SAME answer on every store and on
  // every restart, or an inbound delivery lands in a different tenancy from one
  // minute to the next. The oldest claim wins; the in-memory store cannot lean
  // on map order for it.
  tenancyCase('the older claim on a repository is the one an intake follows', async (stores) => {
    await stores.forOrg(ORG_B).projects.create(project('p-late', { createdAt: 2_000 }))
    await stores.forOrg(ORG_A).projects.create(project('p-early', { createdAt: 1_000 }))
    const ref = { provider: 'github', owner: 'platform', repo: 'api' }
    assert.strictEqual(await stores.tenancy.findOrgIdForProject(ref), ORG_A)
  }),

  // A rename keeps somebody's workspace WITHIN their org, and one GitHub account
  // is a different person in each tenancy that knows them.
  tenancyCase('one host account is a separate person in each org', async (stores) => {
    assert.strictEqual(await stores.forOrg(ORG_A).identities.link('r1', identity()), 'r1')
    assert.strictEqual(await stores.forOrg(ORG_B).identities.link('r2', identity()), 'r2')
    assert.strictEqual(await stores.forOrg(ORG_A).identities.findReviewerId('github', '4711'), 'r1')
    assert.strictEqual(await stores.forOrg(ORG_B).identities.findReviewerId('github', '4711'), 'r2')
    assert.deepStrictEqual(await stores.forOrg(ORG_A).identities.listForReviewer('r2'), [])
  }),

  tenancyCase('attention and commitments stay inside their org', async (stores) => {
    await stores.forOrg(ORG_A).attention.create(attentionRequest('a1'))
    await stores.forOrg(ORG_A).commitments.create(commitment('c1'))
    assert.deepStrictEqual(await stores.forOrg(ORG_B).attention.list({ status: ['open'] }), [])
    assert.strictEqual(await stores.forOrg(ORG_B).attention.getById('a1'), null)
    assert.deepStrictEqual(await stores.forOrg(ORG_B).commitments.listByReviewer('reviewer-1'), [])
    assert.strictEqual(
      await stores.forOrg(ORG_B).commitments.find('reviewer-1', {
        provider: 'github',
        owner: 'platform',
        repo: 'api',
        number: 12,
      }),
      null,
    )
  }),

  // The one read that crosses the boundary on purpose: a digest is presented
  // before anything knows which org the caller is in, so it has to resolve
  // across the whole table AND say where it landed.
  tenancyCase('a session digest resolves to its own org', async (stores) => {
    await stores.forOrg(ORG_A).sessions.create(session('s1', { orgId: ORG_A }))
    await stores.forOrg(ORG_B).sessions.create(session('s2', { orgId: ORG_B, reviewerId: 'r9' }))
    assert.strictEqual((await stores.tenancy.findSessionByDigest('digest-s1'))?.orgId, ORG_A)
    const other = await stores.tenancy.findSessionByDigest('digest-s2')
    assert.strictEqual(other?.orgId, ORG_B)
    assert.strictEqual(other?.reviewerId, 'r9')
  }),

  tenancyCase('signing somebody out does not reach into another org', async (stores) => {
    await stores.forOrg(ORG_A).sessions.create(session('s1', { orgId: ORG_A }))
    await stores.forOrg(ORG_B).sessions.create(session('s2', { orgId: ORG_B }))
    // Same reviewer id in both, which is the case that would go wrong: pausing
    // somebody drops every session of theirs, and `r1` names two people here.
    await stores.forOrg(ORG_A).sessions.deleteForReviewer('r1')
    assert.strictEqual(await stores.tenancy.findSessionByDigest('digest-s1'), null)
    assert.strictEqual((await stores.tenancy.findSessionByDigest('digest-s2'))?.id, 's2')
  }),

  tenancyCase('the expiry sweep only empties the org it runs in', async (stores) => {
    await stores.forOrg(ORG_A).sessions.create(session('s1', { orgId: ORG_A, expiresAt: 10 }))
    await stores.forOrg(ORG_B).sessions.create(session('s2', { orgId: ORG_B, expiresAt: 10 }))
    assert.strictEqual(await stores.forOrg(ORG_A).sessions.deleteExpired(1_000), 1)
    assert.strictEqual((await stores.tenancy.findSessionByDigest('digest-s2'))?.id, 's2')
  }),

  tenancyCase('an API key digest resolves to its own org, with its role', async (stores) => {
    await stores.forOrg(ORG_A).apiKeys.create(apiKey('k1', { orgId: ORG_A, role: 'admin' }))
    await stores.forOrg(ORG_B).apiKeys.create(apiKey('k2', { orgId: ORG_B, role: 'member' }))
    const held = await stores.tenancy.findApiKeyByDigest('digest-k1')
    assert.strictEqual(held?.orgId, ORG_A)
    assert.strictEqual(held?.role, 'admin')
    assert.deepStrictEqual(
      (await stores.forOrg(ORG_B).apiKeys.list()).map((key) => key.id),
      ['k2'],
    )
  }),

  tenancyCase('revoking a key in one org leaves the other org its own', async (stores) => {
    await stores.forOrg(ORG_A).apiKeys.create(apiKey('k1', { orgId: ORG_A }))
    await stores.forOrg(ORG_B).apiKeys.create(apiKey('k2', { orgId: ORG_B }))
    // The id of somebody else's key, which is what a caller can type.
    await stores.forOrg(ORG_A).apiKeys.delete('k2')
    assert.strictEqual((await stores.tenancy.findApiKeyByDigest('digest-k2'))?.id, 'k2')
  }),

  tenancyCase('orgs come back by id, by slug and oldest first', async (stores) => {
    await stores.orgs.create(org('org-a', { slug: 'alpha', createdAt: 1_000 }))
    await stores.orgs.create(org('org-b', { slug: 'beta', createdAt: 2_000 }))
    assert.deepStrictEqual(
      (await stores.orgs.list()).map((row) => row.slug),
      ['alpha', 'beta'],
    )
    assert.strictEqual((await stores.orgs.getById('org-b'))?.slug, 'beta')
    assert.strictEqual((await stores.orgs.getBySlug('alpha'))?.id, 'org-a')
    assert.strictEqual(await stores.orgs.getBySlug('gamma'), null)
  }),

  // The slug is a CLAIM: whoever gets there first owns it, and the loser is told
  // which row won rather than quietly renaming somebody else's tenancy.
  tenancyCase('the first writer owns a slug and the second is told who did', async (stores) => {
    await stores.orgs.create(org('org-a', { slug: 'alpha', name: 'First' }))
    const answered = await stores.orgs.create(org('org-b', { slug: 'alpha', name: 'Second' }))
    assert.strictEqual(answered.id, 'org-a')
    assert.strictEqual(answered.name, 'First')
    assert.strictEqual(await stores.orgs.getById('org-b'), null)
  }),

  tenancyCase('renaming an org keeps its id and moves its slug', async (stores) => {
    await stores.orgs.create(org('org-a', { slug: 'alpha' }))
    assert.strictEqual((await stores.orgs.update('org-a', { slug: 'omega' }))?.slug, 'omega')
    assert.strictEqual((await stores.orgs.getBySlug('omega'))?.id, 'org-a')
    assert.strictEqual(await stores.orgs.getBySlug('alpha'), null)
    assert.strictEqual(await stores.orgs.update('org-nobody-made', { slug: 'x' }), null)
  }),
]

/** One assertion about the boundary, run against every store. See `ConformanceCase`. */
export interface TenancyCase {
  readonly name: string
  run(stores: PersistenceProvider): Promise<void>
}

export function tenancyCase(
  name: string,
  run: (stores: PersistenceProvider) => Promise<void>,
): TenancyCase {
  return { name, run }
}
