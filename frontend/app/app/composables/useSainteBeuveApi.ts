import { createSainteBeuveApi, type SainteBeuveApi } from '../utils/sainteBeuveApi'

/**
 * The API client, wired to this deployment's backend.
 *
 * All the client is in `createSainteBeuveApi`, which takes a base URL and knows
 * nothing about Nuxt; this reads the one piece of configuration it needs. The
 * split is what lets the client be tested without a Nuxt app around it, and it is
 * why every screen still reaches the backend through exactly one thing.
 *
 * One client per base URL, kept here. `createSainteBeuveApi` builds a wretch
 * instance and a closure per method, and seven call sites ask for it, one of them
 * per expanded board row, so building it on every call allocated all of that on
 * every navigation.
 *
 * A module-level cache is safe BECAUSE this app is `ssr: false`. On a server it
 * would be state shared between requests, which is why the key is the base URL the
 * caller asked for rather than an implicit single slot.
 */
const clients = new Map<string, SainteBeuveApi>()

export function useSainteBeuveApi(): SainteBeuveApi {
  const apiBase = useRuntimeConfig().public.apiBase
  const existing = clients.get(apiBase)
  if (existing !== undefined) return existing

  const created = createSainteBeuveApi(apiBase)
  clients.set(apiBase, created)
  return created
}
