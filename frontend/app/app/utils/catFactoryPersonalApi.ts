import {
  clearCatFactoryPersonalKeyContract,
  getCatFactoryPersonalContract,
  setCatFactoryPersonalKeyContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// The caller's own cat-factory key, which runs AI reviews on their model subscription.
export function catFactoryPersonalCalls(call: ContractCaller) {
  return {
    getCatFactoryPersonal: () => call(getCatFactoryPersonalContract, {}),
    setCatFactoryPersonalKey: (token: string) =>
      call(setCatFactoryPersonalKeyContract, { body: { token } }),
    clearCatFactoryPersonalKey: () => call(clearCatFactoryPersonalKeyContract, {}),
  }
}
