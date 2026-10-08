import * as v from 'valibot'

// ---------------------------------------------------------------------------
// cat-factory connection wire contracts.
//
// Everything about reaching cat-factory belongs to an ORG and is entered on the
// Configuration screen: where the instance is, which service reviews are filed
// under, which pipeline they run on, and the API key (a sealed credential under
// `cat-factory` in `settings.ts`). None of it is read from the environment,
// because the key spends one org's budget and the service is one org's
// repository frame: a deployment-wide value would be lent across the boundary.
// ---------------------------------------------------------------------------

/** An instance origin. HTTP is accepted because a local cat-factory serves plain HTTP on loopback. */
const baseUrlSchema = v.pipe(
  v.string(),
  v.trim(),
  v.url(),
  v.regex(/^https?:\/\//i, 'The base URL has to be an http or https URL'),
  v.maxLength(512),
)

/** A cat-factory id, as it appears in its own API. Blank is normalised to null by the caller. */
const catFactoryIdSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))

/**
 * The non-secret half of an org's cat-factory connection. The key is not here:
 * it is write-only and stored sealed, beside the other credentials.
 */
export const catFactoryConfigSchema = v.object({
  baseUrl: baseUrlSchema,
  /**
   * The service (repository frame) AI reviews are filed under. Null leaves the
   * AI reviewer off while the guided reviewer still works, because cat-factory
   * finds a guided review's repository from the pull request itself.
   */
  serviceId: v.nullable(catFactoryIdSchema),
  /** The pipeline AI reviews run on. Null runs the task's own pinned pipeline. */
  pipelineId: v.nullable(catFactoryIdSchema),
})
export type CatFactoryConfig = v.InferOutput<typeof catFactoryConfigSchema>

export const catFactoryConnectionSchema = v.object({
  /** What this org stored. Null when it has not configured cat-factory. */
  config: v.nullable(catFactoryConfigSchema),
  /**
   * What the deployment proposes for an empty form: the defaults a local
   * cat-factory instance serves with, in local mode. Never used until an admin
   * saves it.
   */
  suggested: v.nullable(catFactoryConfigSchema),
  /** A key, a base URL and a service id are all in place, so a review can be filed. */
  aiReviewReady: v.boolean(),
  /** A key and a base URL are in place, so a guided review can be opened. */
  guidedReviewReady: v.boolean(),
})
export type CatFactoryConnection = v.InferOutput<typeof catFactoryConnectionSchema>

/**
 * A configuration to try before (or after) saving it. The key is optional: left
 * out, the org's stored key is used if the base URL is the stored one, so an
 * admin can re-test without pasting it again. Any other URL needs a key pasted.
 */
export const checkCatFactorySchema = v.object({
  ...catFactoryConfigSchema.entries,
  apiKey: v.optional(v.pipe(v.string(), v.trim(), v.minLength(8), v.maxLength(1024))),
})
export type CheckCatFactory = v.InferOutput<typeof checkCatFactorySchema>

/**
 * One step of a check, in the order they run. A step after a failed one is
 * `skipped` rather than failed, so the screen points at the first thing to fix.
 */
export const catFactoryCheckStepSchema = v.object({
  step: v.picklist(['key', 'reachable', 'authenticated', 'scope', 'service', 'pipeline']),
  outcome: v.picklist(['passed', 'failed', 'skipped']),
  message: v.string(),
})
export type CatFactoryCheckStep = v.InferOutput<typeof catFactoryCheckStepSchema>

export const catFactoryCheckSchema = v.object({
  /** No step failed. */
  ok: v.boolean(),
  steps: v.array(catFactoryCheckStepSchema),
  /** What the instance offers this key, so the screen can offer them as choices. Empty when it could not be asked. */
  services: v.array(v.object({ id: v.string(), title: v.string() })),
  pipelines: v.array(v.object({ id: v.string(), name: v.string() })),
})
export type CatFactoryCheck = v.InferOutput<typeof catFactoryCheckSchema>
