import type { CatFactoryConfig } from '@sainte-beuve/contracts'
import type { AppContainer } from '../container.js'
import { openCredential } from './resolve.js'

/**
 * Where the org's cat-factory serves its web app, for links into it: the
 * configured app URL, else what the instance answers, else its API base URL.
 */
export async function catFactoryAppUrl(
  container: AppContainer,
  config: CatFactoryConfig,
): Promise<string> {
  if (config.appUrl !== null || container.gateways === null) return config.appUrl ?? config.baseUrl
  const apiKey = await openCredential(container, 'cat-factory')
  if (apiKey === null) return config.baseUrl
  return container.gateways.catFactoryProbe({ baseUrl: config.baseUrl, apiKey }).appUrl(null)
}
