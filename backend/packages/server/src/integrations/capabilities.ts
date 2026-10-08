import type { Capabilities, CapabilityName } from '@sainte-beuve/contracts'
import { CAPABILITY_NAMES } from '@sainte-beuve/contracts'
import type { AppContainer } from '../container.js'
import { resolveAiReview, resolveGuidedReview } from './resolve.js'

/** What answers each capability: a resolution that is null when the org cannot use it. */
const RESOLVERS: Record<CapabilityName, (container: AppContainer) => Promise<unknown>> = {
  aiReview: resolveAiReview,
  guidedReview: resolveGuidedReview,
}

/** Every capability for this container's org, resolved together. */
export async function resolveCapabilities(container: AppContainer): Promise<Capabilities> {
  const answers = await Promise.all(
    CAPABILITY_NAMES.map(async (name) => [name, (await RESOLVERS[name](container)) !== null]),
  )
  return Object.fromEntries(answers) as Capabilities
}
