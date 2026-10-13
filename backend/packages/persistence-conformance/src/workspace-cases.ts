import assert from 'node:assert/strict'
import { type ConformanceCase, conformanceCase } from './case.js'
import { attentionRequest, identity, project } from './fixtures.js'

/** The projects a deployment watches, and who its people are on each host. */
export const projectCases: readonly ConformanceCase[] = [
  conformanceCase('a project comes back with its own skill vocabulary', async (repos) => {
    const written = project('p1', { skills: ['payments', 'terraform'] })
    assert.deepStrictEqual(await repos.projects.create(written), written)
    assert.deepStrictEqual(await repos.projects.getById('p1'), written)
  }),

  conformanceCase('lists the registry oldest first, ties on the id', async (repos) => {
    await repos.projects.create(project('p2', { repo: 'web', createdAt: 2_000 }))
    await repos.projects.create(project('p1', { repo: 'api', createdAt: 1_000 }))
    await repos.projects.create(project('p3', { repo: 'jobs', createdAt: 2_000 }))
    const ids = (await repos.projects.list()).map((row) => row.id)
    assert.deepStrictEqual(ids, ['p1', 'p2', 'p3'])
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

  conformanceCase('a project keeps its merge comments and its merge restriction', async (repos) => {
    await repos.projects.create(project('p1'))
    const comments = [{ label: 'Queue', body: '@bot merge' }]
    const updated = await repos.projects.update('p1', {
      mergeComments: comments,
      restrictDirectMerge: true,
    })
    assert.deepStrictEqual(
      updated,
      project('p1', { mergeComments: comments, restrictDirectMerge: true }),
    )
    assert.deepStrictEqual(await repos.projects.getById('p1'), updated)
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
    // Linked GitLab first and asserted in `(provider, subject)` order, which is
    // what both durable stores answer with. Sorting the result before asserting
    // would let a store answer in whatever order it stored them.
    await repos.identities.link('r1', identity({ provider: 'gitlab', subject: '99' }))
    await repos.identities.link('r1', identity({ provider: 'github', subject: '4711' }))
    const providers = (await repos.identities.listForReviewer('r1')).map((row) => row.provider)
    assert.deepStrictEqual(providers, ['github', 'gitlab'])
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

  conformanceCase(
    'an ask keeps the people it named, in the order they were named',
    async (repos) => {
      const recipients = [
        { reviewerId: 'r2', displayName: 'Two' },
        { reviewerId: 'r1', displayName: 'One' },
      ]
      await repos.attention.create(attentionRequest('a1', { recipients, neededCommitments: 2 }))
      assert.deepStrictEqual((await repos.attention.getById('a1'))?.recipients, recipients)
      const [listed] = await repos.attention.list({ status: ['open'] })
      assert.deepStrictEqual(listed?.recipients, recipients)
    },
  ),

  conformanceCase('lists the asks newest first, ties on the id', async (repos) => {
    await repos.attention.create(attentionRequest('a1', { createdAt: 1_000 }))
    await repos.attention.create(attentionRequest('a2', { createdAt: 2_000 }))
    await repos.attention.create(attentionRequest('a3', { createdAt: 2_000 }))
    const ids = (await repos.attention.list()).map((row) => row.id)
    assert.deepStrictEqual(ids, ['a3', 'a2', 'a1'])
  }),

  conformanceCase('the inbox reads only what is still open', async (repos) => {
    await repos.attention.create(attentionRequest('a1', { status: 'open', createdAt: 1_000 }))
    await repos.attention.create(attentionRequest('a2', { status: 'resolved', createdAt: 2_000 }))
    await repos.attention.create(attentionRequest('a3', { status: 'cancelled', createdAt: 3_000 }))
    const ids = (await repos.attention.list({ status: ['open'] })).map((row) => row.id)
    assert.deepStrictEqual(ids, ['a1'])
    assert.deepStrictEqual(await repos.attention.list({ status: [] }), [])
  }),
]
