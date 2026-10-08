import type { CatFactoryConfig } from '@sainte-beuve/contracts'
import type { AppContainer } from '../container.js'

const INTEGRATION_ID = 'cat-factory'

/**
 * This org's cat-factory settings, as the Configuration screen stored them.
 *
 * There is no environment fallback for any of it. The service and the key are
 * one org's (its repository frame and its budget), so a deployment-wide value
 * would be lent across the tenancy boundary, and the base URL travels with them
 * because a key is only valid on the instance that minted it.
 */
/** The optional fields, stored only when set. `baseUrl` is the one that is always there. */
const OPTIONAL_FIELDS = [
  'serviceId',
  'pipelineId',
] as const satisfies readonly (keyof CatFactoryConfig)[]

export async function readCatFactoryConfig(
  container: AppContainer,
): Promise<CatFactoryConfig | null> {
  const values = (await container.repositories.integrationConfigs.get(INTEGRATION_ID))?.values
  if (values?.baseUrl === undefined) return null
  const optional = OPTIONAL_FIELDS.map((field) => [field, values[field] ?? null])
  return { baseUrl: values.baseUrl, ...Object.fromEntries(optional) } as CatFactoryConfig
}

export async function writeCatFactoryConfig(
  container: AppContainer,
  config: CatFactoryConfig,
): Promise<void> {
  const set = OPTIONAL_FIELDS.flatMap((field) => {
    const value = config[field]
    return value === null ? [] : [[field, value]]
  })
  await container.repositories.integrationConfigs.put({
    integrationId: INTEGRATION_ID,
    values: { baseUrl: originOf(config.baseUrl), ...Object.fromEntries(set) },
    updatedAt: container.clock.now(),
  })
}

export async function clearCatFactoryConfig(container: AppContainer): Promise<void> {
  await container.repositories.integrationConfigs.delete(INTEGRATION_ID)
}

/**
 * The URL without a trailing slash, so `http://localhost:8787/` and the same
 * without the slash are one instance. The SDK appends `/api/v1/...` to it.
 */
export function originOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}
