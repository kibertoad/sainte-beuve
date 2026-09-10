import { createSainteBeuveApi, type SainteBeuveApi } from '../utils/sainteBeuveApi'

/**
 * The API client, wired to this deployment's backend.
 *
 * All the client is in `createSainteBeuveApi`, which takes a base URL and knows
 * nothing about Nuxt; this reads the one piece of configuration it needs. The
 * split is what lets the client be tested without a Nuxt app around it, and it is
 * why every screen still reaches the backend through exactly one thing.
 */
export function useSainteBeuveApi(): SainteBeuveApi {
  return createSainteBeuveApi(useRuntimeConfig().public.apiBase)
}
