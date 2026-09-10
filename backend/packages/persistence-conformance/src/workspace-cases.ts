import assert from 'node:assert/strict'
import { type ConformanceCase, conformanceCase } from './case.js'
import { attentionRequest, commitment, identity, project, pullRequest } from './fixtures.js'

/** The projects a deployment watches, and who its people are on each host. */
export const projectCases: readonly ConformanceCase[] = [
  conformanceCase('a project comes back with its own skill vocabulary', async (repos) => {
    const written = project('p1', { skills: ['payments', 'terraform'] })
    assert.deepStrictEqual(await repos.projects.create(written), written)
    assert.deepStrictEqual(await repos.projects.getById('p1'), written)
  }),

  conformanceCase('lists the registry oldest first', async (repos) => {
    await repos.projects.create(project('p2', { repo: 'web', createdAt: 2_000 }))
    await repos.projects.create(project('p1', { repo: 'api', createdAt: 1_000 }))
    const ids = (await repos.projects.list()).map((row) => row.id)
    assert.deepStrictEqual(ids, ['p1', 'p2'])
  }),

  conformanceCase('a repository is found however it was capitalised', async (repos) => {
    // Both hosts treat `Platform/API` and `platform/api` as one repository, so
    // registering the second must find the first rather than list it twice.
    await repos.projects.create(project('p1', { owner: 'platform', repo: 'api' }))
    const found = await repos.projects.getByRef({
      provider: 'github',
      owner: 'Platform',
      repo: 'API',
    })
    assert.strictEqual(found?.id, 'p1')
  }),

  conformanceCase('the same path on another host is another project', async (repos) => {
    await repos.projects.create(project('p1', { provider: 'github' }))
    const found = await repos.projects.getByRef({
      provider: 'gitlab',
      owner: 'platform',
      repo: 'api',
    })
    assert.strictEqual(found, null)
  }),

  conformanceCase('a project patch touches the fields it names', async (repos) => {
    await repos.projects.create(project('p1'))
    const updated = await repos.projects.update('p1', { skills: ['payments'] })
    assert.deepStrictEqual(updated?.skills, ['payments'])
    assert.strictEqual(updated?.repo, 'api')
    assert.strictEqual((await repos.projects.getByRef(project('p1')))?.id, 'p1')
  }),

  conformanceCase('patching a project that is not there answers null', async (repos) => {
    assert.strictEqual(await repos.projects.update('nobody', { skills: [] }), null)
  }),

  conformanceCase('un-registering a project frees its repository', async (repos) => {
    await repos.projects.create(project('p1'))
    await repos.projects.delete('p1')
    assert.deepStrictEqual(await repos.projects.list(), [])
    assert.strictEqual(await repos.projects.getByRef(project('p1')), null)
    // Registering it again is a fresh row, not a resurrection of the old id.
    await repos.projects.create(project('p2'))
    assert.strictEqual((await repos.projects.getByRef(project('p2')))?.id, 'p2')
  }),
]

export const identityCases: readonly ConformanceCase[] = [
  conformanceCase('an account is claimed by the person it was linked to', async (repos) => {
    const holder = await repos.identities.link('r1', identity({ subject: '4711' }))
    assert.strictEqual(holder, 'r1')
    assert.strictEqual(await repos.identities.findReviewerId('github', '4711'), 'r1')
  }),

  conformanceCase('an account nobody linked belongs to nobody', async (repos) => {
    assert.strictEqual(await repos.identities.findReviewerId('github', '4711'), null)
  }),

  conformanceCase('the first claim wins, and the loser is told whose it is', async (repos) => {
    // Two first sign-ins that both found no row are how a directory forks into
    // two people with one account between them. The second caller has to be
    // told which row won rather than keeping its own.
    await repos.identities.link('r1', identity({ subject: '4711' }))
    const holder = await repos.identities.link('r2', identity({ subject: '4711' }))
    assert.strictEqual(holder, 'r1')
    assert.strictEqual(await repos.identities.findReviewerId('github', '4711'), 'r1')
    assert.deepStrictEqual(await repos.identities.listForReviewer('r2'), [])
  }),

  conformanceCase('the holder refreshes the handle it is known by', async (repos) => {
    // A login is display metadata and it changes under us; the subject does not.
    await repos.identities.link('r1', identity({ subject: '4711', username: 'octocat' }))
    await repos.identities.link('r1', identity({ subject: '4711', username: 'renamed' }))
    const linked = await repos.identities.listForReviewer('r1')
    assert.deepStrictEqual(
      linked.map((row) => row.username),
      ['renamed'],
    )
  }),

  conformanceCase('somebody else cannot rename the account they lost', async (repos) => {
    await repos.identities.link('r1', identity({ subject: '4711', username: 'octocat' }))
    await repos.identities.link('r2', identity({ subject: '4711', username: 'impostor' }))
    const linked = await repos.identities.listForReviewer('r1')
    assert.deepStrictEqual(
      linked.map((row) => row.username),
      ['octocat'],
    )
  }),

  conformanceCase('one person holds an account on each host', async (repos) => {
    await repos.identities.link('r1', identity({ provider: 'github', subject: '4711' }))
    await repos.identities.link('r1', identity({ provider: 'gitlab', subject: '99' }))
    const providers = (await repos.identities.listForReviewer('r1')).map((row) => row.provider)
    assert.deepStrictEqual(providers.toSorted(), ['github', 'gitlab'])
    assert.strictEqual(await repos.identities.findReviewerId('gitlab', '99'), 'r1')
    assert.strictEqual(await repos.identities.findReviewerId('github', '99'), null)
  }),
]

export const attentionCases: readonly ConformanceCase[] = [
  conformanceCase('an ask comes back with every field it was raised with', async (repos) => {
    const written = attentionRequest('a1', { sameTeamOnly: true, neededCommitments: 3, note: 'hi' })
    assert.deepStrictEqual(await repos.attention.create(written), written)
    assert.deepStrictEqual(await repos.attention.getById('a1'), written)
  }),

  conformanceCase('lists the asks newest first', async (repos) => {
    await repos.attention.create(attentionRequest('a1', { createdAt: 1_000 }))
    await repos.attention.create(attentionRequest('a2', { createdAt: 2_000 }))
    const ids = (await repos.attention.list()).map((row) => row.id)
    assert.deepStrictEqual(ids, ['a2', 'a1'])
  }),

  conformanceCase('the inbox reads only what is still open', async (repos) => {
    await repos.attention.create(attentionRequest('a1', { status: 'open', createdAt: 1_000 }))
    await repos.attention.create(attentionRequest('a2', { status: 'resolved', createdAt: 2_000 }))
    await repos.attention.create(attentionRequest('a3', { status: 'cancelled', createdAt: 3_000 }))
    const ids = (await repos.attention.list({ status: ['open'] })).map((row) => row.id)
    assert.deepStrictEqual(ids, ['a1'])
    assert.deepStrictEqual(await repos.attention.list({ status: [] }), [])
  }),

  conformanceCase('an ask records the people who answered it', async (repos) => {
    await repos.attention.create(attentionRequest('a1'))
    const updated = await repos.attention.update('a1', {
      commitments: [{ reviewerId: 'r1', displayName: 'One', committedAt: 3_000 }],
      status: 'resolved',
      resolvedAt: 3_000,
    })
    assert.strictEqual(updated?.commitments.length, 1)
    assert.strictEqual(updated?.status, 'resolved')
    assert.deepStrictEqual(await repos.attention.list({ status: ['open'] }), [])
  }),

  conformanceCase('patching an ask that is not there answers null', async (repos) => {
    assert.strictEqual(await repos.attention.update('nobody', { status: 'cancelled' }), null)
  }),
]

export const commitmentCases: readonly ConformanceCase[] = [
  conformanceCase('a promise comes back with what it was made about', async (repos) => {
    const written = commitment('c1', { attentionRequestId: 'a1' })
    assert.deepStrictEqual(await repos.commitments.create(written), written)
    assert.deepStrictEqual(await repos.commitments.getById('c1'), written)
  }),

  conformanceCase("lists one person's promises newest first", async (repos) => {
    await repos.commitments.create(commitment('c1', { createdAt: 1_000 }))
    await repos.commitments.create(
      commitment('c2', { createdAt: 2_000, pullRequest: pullRequest({ number: 13 }) }),
    )
    await repos.commitments.create(commitment('c3', { reviewerId: 'r2' }))
    const ids = (await repos.commitments.listByReviewer('reviewer-1')).map((row) => row.id)
    assert.deepStrictEqual(ids, ['c2', 'c1'])
  }),

  conformanceCase('a second click on the same pull request finds the first', async (repos) => {
    await repos.commitments.create(commitment('c1'))
    const found = await repos.commitments.find('reviewer-1', pullRequest())
    assert.strictEqual(found?.id, 'c1')
    assert.strictEqual(await repos.commitments.find('r2', pullRequest()), null)
  }),

  conformanceCase('the same number on the other host is another promise', async (repos) => {
    // `platform/api#12` exists on GitHub and on GitLab, and they are two
    // different changes. A lookup that matched on the path alone would answer
    // the second with the first and leave no row for it.
    await repos.commitments.create(
      commitment('c1', { pullRequest: pullRequest({ provider: 'github' }) }),
    )
    const found = await repos.commitments.find('reviewer-1', pullRequest({ provider: 'gitlab' }))
    assert.strictEqual(found, null)
  }),

  conformanceCase('withdrawing a promise removes it', async (repos) => {
    await repos.commitments.create(commitment('c1'))
    await repos.commitments.delete('c1')
    assert.strictEqual(await repos.commitments.getById('c1'), null)
    assert.deepStrictEqual(await repos.commitments.listByReviewer('reviewer-1'), [])
    assert.strictEqual(await repos.commitments.find('reviewer-1', pullRequest()), null)
  }),
]
