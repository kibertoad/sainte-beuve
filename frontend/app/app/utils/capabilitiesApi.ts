import { getCapabilitiesContract } from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// What this org can do that depends on an integration. Any member may read it,
// which is why it is not with the Configuration screen's calls.
export function capabilityCalls(call: ContractCaller) {
  return {
    getCapabilities: () => call(getCapabilitiesContract, {}),
  }
}
