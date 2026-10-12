import type { CapabilityName } from '@sainte-beuve/contracts'

/**
 * What this org can do that depends on an integration, read once and shared by
 * every screen that warns about it. Unknown (still loading, or the read failed)
 * counts as available, so a slow or older backend never shows a false warning.
 */
export function useCapabilities() {
  const api = useSainteBeuveApi()
  const { data, refresh } = useAsyncData('capabilities', () => api.getCapabilities(), {
    lazy: true,
  })
  return {
    available: (name: CapabilityName): boolean => data.value?.[name] ?? true,
    /** Only what the backend has said is on, for a capability that hides something when it is. */
    confirmed: (name: CapabilityName): boolean => data.value?.[name] === true,
    refresh,
  }
}
