import type { Reminder, Reviewer } from '@sainte-beuve/contracts'
import type { StoredIntegrationToken } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import {
  InMemoryIntegrationTokenRepository,
  InMemoryReminderRepository,
  InMemoryReviewerRepository,
  createInMemoryRepositories,
} from './stores.js'

function reviewer(id: string, overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    id,
    displayName: id,
    handles: { github: id, gitlab: null },
    slackUserId: null,
    team: null,
    skills: [],
    availability: 'available',
    role: 'member',
    weight: 1,
    outstandingReviews: 0,
    createdAt: 0,
    ...overrides,
  }
}

function reminder(id: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    reviewId: 'rev-1',
    kind: 'pending',
    channel: 'slack_dm',
    reviewerId: null,
    dueAt: 0,
    snoozedUntil: null,
    status: 'scheduled',
    sentAt: null,
    failureReason: null,
    createdAt: 0,
    ...overrides,
  }
}

describe('InMemoryReviewerRepository', () => {
  it('returns copies, so a caller cannot rewrite the store by mutating a read', async () => {
    const repo = new InMemoryReviewerRepository()
    await repo.create(reviewer('a', { skills: ['typescript'] }))
    const read = await repo.getById('a')
    read?.skills.push('rust')
    expect((await repo.getById('a'))?.skills).toStrictEqual(['typescript'])
  })

  it('copies what a patch hands it, so a caller cannot rewrite the store after the write', async () => {
    const repo = new InMemoryReviewerRepository()
    await repo.create(reviewer('a'))
    const skills = ['typescript']
    await repo.update('a', { skills })
    skills.push('rust')
    expect((await repo.getById('a'))?.skills).toStrictEqual(['typescript'])
  })

  it('refuses to let a patch change the id', async () => {
    const repo = new InMemoryReviewerRepository()
    await repo.create(reviewer('a'))
    const updated = await repo.update('a', { id: 'b', displayName: 'Renamed' })
    expect(updated?.id).toBe('a')
    expect(updated?.displayName).toBe('Renamed')
    expect(await repo.getById('b')).toBeNull()
  })

  it('floors the outstanding counter at zero', async () => {
    const repo = new InMemoryReviewerRepository()
    await repo.create(reviewer('a'))
    await repo.adjustOutstanding('a', -5)
    expect((await repo.getById('a'))?.outstandingReviews).toBe(0)
  })

  it('ignores an adjustment for a reviewer that is gone', async () => {
    const repo = new InMemoryReviewerRepository()
    await expect(repo.adjustOutstanding('ghost', 1)).resolves.toBeUndefined()
  })
})

describe('InMemoryReminderRepository', () => {
  it('serves due reminders oldest first, capped at the batch size', async () => {
    const repo = new InMemoryReminderRepository()
    await repo.create(reminder('c', { dueAt: 300 }))
    await repo.create(reminder('a', { dueAt: 100 }))
    await repo.create(reminder('b', { dueAt: 200 }))
    const due = await repo.listDue(1000, 2)
    expect(due.map((r) => r.id)).toStrictEqual(['a', 'b'])
  })

  it('leaves a reminder that is not due yet alone', async () => {
    const repo = new InMemoryReminderRepository()
    await repo.create(reminder('a', { dueAt: 500 }))
    expect(await repo.listDue(499, 10)).toStrictEqual([])
    expect((await repo.listDue(500, 10)).map((r) => r.id)).toStrictEqual(['a'])
  })

  it('cancels only the scheduled reminders of the review it was asked about', async () => {
    const repo = new InMemoryReminderRepository()
    await repo.create(reminder('a', { reviewId: 'rev-1' }))
    await repo.create(reminder('b', { reviewId: 'rev-1', status: 'sent', sentAt: 1 }))
    await repo.create(reminder('c', { reviewId: 'rev-2' }))
    await repo.cancelScheduledForReview('rev-1')

    const first = await repo.listByReview('rev-1')
    expect(first.find((r) => r.id === 'a')?.status).toBe('cancelled')
    // A sent reminder keeps its record: cancelling is about the schedule ahead,
    // not about rewriting what already happened.
    expect(first.find((r) => r.id === 'b')?.status).toBe('sent')
    expect((await repo.listByReview('rev-2'))[0]?.status).toBe('scheduled')
  })
})

describe('InMemoryIntegrationTokenRepository', () => {
  const row = (overrides: Partial<StoredIntegrationToken> = {}): StoredIntegrationToken => ({
    integrationId: 'cat-factory',
    sealed: 'v1.a',
    hint: 'aaaa',
    subject: null,
    updatedAt: 1,
    ...overrides,
  })

  it('replaces the token of an integration instead of keeping a second row', async () => {
    const repo = new InMemoryIntegrationTokenRepository()
    await repo.put(row())
    await repo.put(row({ sealed: 'v1.b', hint: 'bbbb', updatedAt: 2 }))

    expect(await repo.list()).toStrictEqual([row({ sealed: 'v1.b', hint: 'bbbb', updatedAt: 2 })])
  })

  it('keeps whose credential it is, for a screen that has to name the account', async () => {
    const repo = new InMemoryIntegrationTokenRepository()
    await repo.put(row({ integrationId: 'github-oauth', subject: 'kibertoad' }))
    expect(await repo.get('github-oauth')).toMatchObject({ subject: 'kibertoad' })
  })

  it('reads back nothing for an integration that was cleared', async () => {
    const repo = new InMemoryIntegrationTokenRepository()
    await repo.put(row())
    await repo.delete('cat-factory')
    expect(await repo.get('cat-factory')).toBeNull()
  })
})

describe('createInMemoryRepositories', () => {
  it('hands back independent stores', async () => {
    const repos = createInMemoryRepositories()
    await repos.reviewers.create(reviewer('a'))
    expect(await repos.reviewers.list()).toHaveLength(1)
    expect(await repos.reviews.list()).toStrictEqual([])
    expect(await repos.aiReviewRuns.listByReview('rev-1')).toStrictEqual([])
    expect(await repos.integrationTokens.list()).toStrictEqual([])
  })
})
