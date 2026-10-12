import type { RepositorySync } from '@sainte-beuve/contracts'
import type { AppContainer } from '../container.js'

/**
 * How far one source's repository sync has got, in the org's integration
 * settings beside that source's own. Flat strings, as every setting there is.
 */
export interface RepositorySyncState extends RepositorySync {
  cursor: number | null
}

const EMPTY: RepositorySyncState = {
  cursor: null,
  syncedAt: null,
  reconciledAt: null,
  webhook: 'pending',
  webhookUrl: null,
  error: null,
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
    syncedAt: numberOrNull(values.syncedAt),
    reconciledAt: numberOrNull(values.reconciledAt),
    webhook:
      values.webhook === 'registered' || values.webhook === 'failed' ? values.webhook : 'pending',
    webhookUrl: values.webhookUrl ?? null,
    error: values.error ?? null,
  }
}

/** Merge `patch` into the stored state. */
export async function writeRepositorySyncState(
  container: AppContainer,
  source: string,
  patch: Partial<RepositorySyncState>,
): Promise<RepositorySyncState> {
  const next = { ...(await readRepositorySyncState(container, source)), ...patch }
  const values = Object.entries(next).flatMap(([field, value]) =>
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

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
