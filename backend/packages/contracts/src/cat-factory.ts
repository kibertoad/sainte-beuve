import * as v from 'valibot'
import { peopleSyncSchema } from './external-directory.js'
import { vcsProviderSchema } from './vcs.js'

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
function originSchema(name: string) {
  return v.pipe(
    v.string(),
    v.trim(),
    v.url(),
    v.regex(/^https?:\/\//i, `The ${name} has to be an http or https URL`),
    v.maxLength(512),
  )
}

/** A cat-factory id, as it appears in its own API. Blank is normalised to null by the caller. */
const catFactoryIdSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))

/**
 * The non-secret half of an org's cat-factory connection. The key is not here:
 * it is write-only and stored sealed, beside the other credentials.
 */
export const catFactoryConfigSchema = v.object({
  /** Where the API answers. Every call goes here, and the key is sent nowhere else. */
  baseUrl: originSchema('base URL'),
  /**
   * Where the web app is served, for the links a screen offers into cat-factory
   * (a task, the add-service window). A deployment can serve the app and the API
   * on different origins. Null asks the instance, then falls back to `baseUrl`.
   */
  appUrl: v.optional(v.nullable(originSchema('app URL')), null),
  /**
   * The service (repository frame) an AI review goes under when no service
   * backs its repository in cat-factory, a monorepo for one. A review normally
   * goes under its own repository's service. Null files only there.
   */
  serviceId: v.nullable(catFactoryIdSchema),
  /** The pipeline AI reviews run on. Null runs the task's own pinned pipeline. */
  pipelineId: v.nullable(catFactoryIdSchema),
})
export type CatFactoryConfig = v.InferOutput<typeof catFactoryConfigSchema>

/**
 * What the key reaches: `account` reads the whole directory, `workspaces` is a
 * key limited to some workspaces, which cat-factory lists no users to.
 */
export const directoryReachSchema = v.picklist(['account', 'workspaces'])
export type DirectoryReach = v.InferOutput<typeof directoryReachSchema>

/**
 * How this org's repository list is kept in step with cat-factory's directory.
 * Times are epoch ms; null until the first time each one happened.
 */
export const repositorySyncSchema = v.object({
  /** The last time the change feed was followed to its head. */
  syncedAt: v.nullable(v.number()),
  /** The last full snapshot walk. */
  reconciledAt: v.nullable(v.number()),
  /**
   * Whether cat-factory pushes directory changes here. `pending` until a
   * registration has been tried; the change feed is followed on the clock either way.
   */
  webhook: v.picklist(['registered', 'failed', 'pending']),
  /** The URL cat-factory was asked to push to. */
  webhookUrl: v.nullable(v.string()),
  /** Why the last sync or webhook registration failed, cleared by the next one that worked. */
  error: v.nullable(v.string()),
  /** The people and teams the same directory keeps in step. Null until a sync has read them. */
  people: v.optional(v.nullable(peopleSyncSchema), null),
  /** What the key reached at the last full snapshot walk. Null until one has run. */
  reach: v.optional(v.nullable(directoryReachSchema), null),
})
export type RepositorySync = v.InferOutput<typeof repositorySyncSchema>

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
  /** Null while cat-factory is not configured, when repositories are registered here instead. */
  repositorySync: v.nullable(repositorySyncSchema),
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

/**
 * The `details` of the refusal to file work for a repository that no
 * cat-factory service backs, when the org has no default service either.
 * `addRepositoryUrl` opens cat-factory's add-service window with the repository
 * picked, so a screen can offer it as the fix and then a retry.
 */
export const CAT_FACTORY_REPOSITORY_MISSING = 'cat_factory_repository_missing'

export const catFactoryRepositoryMissingSchema = v.object({
  reason: v.literal(CAT_FACTORY_REPOSITORY_MISSING),
  /** `owner/name`, as the pull request names it. */
  repository: v.string(),
  provider: vcsProviderSchema,
  addRepositoryUrl: v.string(),
})
export type CatFactoryRepositoryMissing = v.InferOutput<typeof catFactoryRepositoryMissingSchema>

/** The refusal's details when that is what they are, else null. */
export function repositoryMissingOf(details: unknown): CatFactoryRepositoryMissing | null {
  const parsed = v.safeParse(catFactoryRepositoryMissingSchema, details)
  return parsed.success ? parsed.output : null
}

/**
 * Where a task's run opens in cat-factory's app. The app is one canvas with no
 * path per entity, so the link is a query on its root: `ws` pins the board,
 * `block` selects the task (a public task id is its board block id) and `run`
 * is what makes the app read the link at all. With no run id yet, the app's
 * root, since a link without one is ignored.
 */
export function catFactoryRunUrl(
  appUrl: string,
  at: { workspaceId: string | null; taskId: string; runId: string | null },
): string {
  const root = `${appUrl.replace(/\/+$/, '')}/`
  if (at.runId === null) return root
  const query = [
    ...(at.workspaceId === null ? [] : [['ws', at.workspaceId]]),
    ['block', at.taskId],
    ['run', at.runId],
  ]
  return `${root}?${query.map(([key, value]) => `${key}=${encodeURIComponent(value ?? '')}`).join('&')}`
}
