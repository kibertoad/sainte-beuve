import type { PeopleSync, RepositorySync } from '@sainte-beuve/contracts'
import type { AppContainer } from '../container.js'

/**
 * How far one source's directory sync has got, in the org's integration
 * settings beside that source's own. Flat strings, as every setting there is.
 */
export interface RepositorySyncState extends RepositorySync {
  cursor: number | null
  /** What the mirror held when it was last walked whole. See `DIRECTORY_MIRROR_VERSION`. */
  mirrorVersion: number | null
}

/**
 * Raised when the mirror starts holding an entity type it read past before, so
 * an org whose cursor is already past those changes walks the snapshots once.
 * 2: people, groups and memberships beside the repositories.
 */
export const DIRECTORY_MIRROR_VERSION = 2

const EMPTY: RepositorySyncState = {
  cursor: null,
  mirrorVersion: null,
  syncedAt: null,
  reconciledAt: null,
  webhook: 'pending',
  webhookUrl: null,
  error: null,
  people: null,
}

function stateId(source: string): string {
  return `repository-sync:${source}`
}

export async function readRepositorySyncState(
  container: AppContainer,
  source: string,
): Promise<RepositorySyncState> {
  const values = (await container.repositories.integrationConfigs.get(stateId(source)))?.values
  if (values === undefined) return { ...EMPTY }
  return {
    cursor: numberOrNull(values.cursor),
    mirrorVersion: numberOrNull(values.mirrorVersion),
    syncedAt: numberOrNull(values.syncedAt),
    reconciledAt: numberOrNull(values.reconciledAt),
    webhook:
      values.webhook === 'registered' || values.webhook === 'failed' ? values.webhook : 'pending',
    webhookUrl: values.webhookUrl ?? null,
    error: values.error ?? null,
    people: peopleOf(values),
  }
}

/** Merge `patch` into the stored state. */
export async function writeRepositorySyncState(
  container: AppContainer,
  source: string,
  patch: Partial<RepositorySyncState>,
): Promise<RepositorySyncState> {
  const next = { ...(await readRepositorySyncState(container, source)), ...patch }
  const { people, ...scalars } = next
  const values = Object.entries({ ...scalars, ...flatPeople(people) }).flatMap(([field, value]) =>
    value === null ? [] : [[field, String(value)]],
  )
  await container.repositories.integrationConfigs.put({
    integrationId: stateId(source),
    values: Object.fromEntries(values),
    updatedAt: container.clock.now(),
  })
  return next
}

/** The state as the connection reports it, without the feed position. */
export function repositorySyncOf({
  cursor: _cursor,
  mirrorVersion: _mirrorVersion,
  ...sync
}: RepositorySyncState): RepositorySync {
  return sync
}

export async function clearRepositorySyncState(
  container: AppContainer,
  source: string,
): Promise<void> {
  await container.repositories.integrationConfigs.delete(stateId(source))
}

function flatPeople(people: PeopleSync | null): Record<string, number | null> {
  return {
    peopleListed: people?.listed ?? null,
    peopleLinked: people?.linked ?? null,
    peopleWithoutAccount: people?.withoutAccount ?? null,
  }
}

function peopleOf(values: Record<string, string>): PeopleSync | null {
  const listed = numberOrNull(values.peopleListed)
  if (listed === null) return null
  return {
    listed,
    linked: numberOrNull(values.peopleLinked) ?? 0,
    withoutAccount: numberOrNull(values.peopleWithoutAccount) ?? 0,
  }
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
