import * as v from 'valibot'

/**
 * What the caller's org can do right now that depends on an integration, for a
 * screen to warn before a button fails. Any member may read it: it says whether
 * something is configured, never how.
 */
export const capabilitiesSchema = v.object({
  /** cat-factory has a key, an instance and a service, so an AI review can be filed. */
  aiReview: v.boolean(),
  /** cat-factory has a key and an instance, so a guided review can be opened. */
  guidedReview: v.boolean(),
})
export type Capabilities = v.InferOutput<typeof capabilitiesSchema>

/** One capability's name, as the keys of {@link capabilitiesSchema}. */
export type CapabilityName = keyof Capabilities

/** Every capability, in the order a screen lists them. */
export const CAPABILITY_NAMES = Object.keys(capabilitiesSchema.entries) as CapabilityName[]
