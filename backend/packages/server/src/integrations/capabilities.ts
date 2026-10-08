import type { Capabilities, CapabilityName } from '@sainte-beuve/contracts'
import { CAPABILITY_NAMES } from '@sainte-beuve/contracts'
import type { AppContainer } from '../container.js'
import {
  type CatFactoryOrgAccess,
  catFactoryAccess,
  resolveAiReview,
  resolveGuidedReview,
} from './resolve.js'

type Resolver = (
  container: AppContainer,
  catFactory: Promise<CatFactoryOrgAccess | null>,
) => Promise<unknown>

/** What answers each capability: a resolution that is null when the org cannot use it. */
const RESOLVERS: Record<CapabilityName, Resolver> = {
  aiReview: resolveAiReview,
  guidedReview: resolveGuidedReview,
}

/** Every capability for this container's org, resolved together over one read of its settings. */
export async function resolveCapabilities(container: AppContainer): Promise<Capabilities> {
  const catFactory = catFactoryAccess(container)
  const answers = await Promise.all(
    CAPABILITY_NAMES.map(async (name) => [
      name,
      (await RESOLVERS[name](container, catFactory)) !== null,
    ]),
  )
  return Object.fromEntries(answers) as Capabilities
}
