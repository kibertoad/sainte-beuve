import { entityKey } from '@cat-factory/directory-sync'
import { describe, expect, it } from 'vitest'
import { locationOf } from './directoryKeys.js'

describe('locationOf', () => {
  it('reads back the workspace and repository of a key the directory sync wrote', () => {
    const key = entityKey({ entityType: 'repo', workspaceId: 'ws-a', entityId: '42' })
    expect(locationOf(key)).toStrictEqual({ workspaceId: 'ws-a', repoId: 42 })
  })

  it.each([
    ['no workspace', '/42'],
    ['no separator', '42'],
    ['no repository', 'ws-a/'],
    ['a repository id that is not a number', 'ws-a/kibertoad'],
  ])('answers null for a key with %s', (_, key) => {
    expect(locationOf(key)).toBeNull()
  })
})
