/**
 * Variables a deployment may still set from an older release, which nothing
 * reads any more. Each facade warns about them once per process (or isolate),
 * so an upgrade that silently switched a capability off says why in its logs.
 */
const RETIRED_VARIABLES = [
  'CAT_FACTORY_BASE_URL',
  'CAT_FACTORY_SERVICE_ID',
  'CAT_FACTORY_PIPELINE_ID',
  'CAT_FACTORY_API_KEY',
] as const

export const RETIRED_VARIABLES_MESSAGE =
  'these variables are no longer read: an admin configures cat-factory per org on the ' +
  'Configuration screen'

/**
 * The retired variables this environment sets to something other than blank.
 * Typed as `object` so the Worker's binding interface, which has no index
 * signature, is accepted as it is.
 */
export function retiredVariablesIn(env: object): string[] {
  const values = env as Readonly<Record<string, unknown>>
  return RETIRED_VARIABLES.filter((name) => {
    const value = values[name]
    return typeof value === 'string' && value.length > 0
  })
}
