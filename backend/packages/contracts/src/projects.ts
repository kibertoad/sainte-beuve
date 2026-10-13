import * as v from 'valibot'
import { mergeCommentListSchema, mergeCommentOverrideSchema } from './merging.js'
import { domainSchema } from './orgs.js'
import { skillSchema } from './reviewers.js'
import { projectRefSchema, repoOwnerSchema, vcsProviderSchema, webUrlSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// The projects a workspace watches.
//
// A project is a repository somebody on this deployment works in. Registering
// one is what puts its open pull requests on the workspace, and it is also the
// only place a team's own vocabulary lives: `skills` is the list an attention
// request picks from, so a Go shop can ask for `goroutines` where the default
// asks for `Backend`.
// ---------------------------------------------------------------------------

/**
 * The skills a project offers until somebody changes them.
 *
 * Two, and coarse on purpose: the first question anyone asks of a pull request
 * is which side of the stack it needs, and a default list long enough to be
 * precise is a list nobody edits because it already looks configured. Teams that
 * want `payments` or `terraform` add them to the project.
 */
export const DEFAULT_PROJECT_SKILLS: readonly string[] = ['Backend', 'Frontend'] as const

/**
 * Which external source a project came from, and the repository's id there.
 * The id is the host's own, so it survives a rename where owner and repo do not.
 */
export const externalRepositoryRefSchema = v.object({
  /** The system the list is synchronised from, `cat-factory` for one. */
  source: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
})
export type ExternalRepositoryRef = v.InferOutput<typeof externalRepositoryRefSchema>

/**
 * One repository as an external source lists it, held so a synchronisation can
 * tell what changed. `key` is the source's own stable key for the entry (one
 * repository can be listed more than once, under different keys), and `seq` is
 * its ordering position: a state with a lower `seq` than the held one is older.
 * `repository` is null once the source dropped the entry; the row stays, so a
 * late, older state cannot bring it back.
 */
export const externalRepositorySchema = v.object({
  source: externalRepositoryRefSchema.entries.source,
  key: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
  seq: v.number(),
  repository: v.nullable(
    v.object({
      provider: vcsProviderSchema,
      owner: projectRefSchema.entries.owner,
      repo: projectRefSchema.entries.repo,
      id: externalRepositoryRefSchema.entries.id,
    }),
  ),
})
export type ExternalRepository = v.InferOutput<typeof externalRepositorySchema>

export const projectSchema = v.object({
  id: v.string(),
  provider: vcsProviderSchema,
  owner: projectRefSchema.entries.owner,
  repo: projectRefSchema.entries.repo,
  /**
   * The project's page on its host. Stored rather than derived: a self-hosted
   * GitLab has no address anything here could guess.
   */
  webUrl: v.nullable(webUrlSchema),
  /** The vocabulary an attention request on this project picks its skills from. */
  skills: v.array(skillSchema),
  /** What the repository is about, which a reviewer's own domains are matched against. */
  domains: v.optional(v.array(domainSchema), () => []),
  /** Replaces the team's and the org's merge comments for this repository. */
  mergeComments: mergeCommentOverrideSchema,
  /**
   * Refuses a direct merge from sainte-beuve while merge comments are in force
   * here, so a merge goes through the bot. An admin may still override it.
   */
  restrictDirectMerge: v.optional(v.boolean(), false),
  /**
   * Set on a project that an external system's repository list put here, which
   * then decides whether it stays. Absent on one an admin registered.
   */
  external: v.optional(v.nullable(externalRepositoryRefSchema)),
  createdAt: v.number(),
})
export type Project = v.InferOutput<typeof projectSchema>

export const createProjectSchema = v.object({
  provider: vcsProviderSchema,
  owner: projectRefSchema.entries.owner,
  repo: projectRefSchema.entries.repo,
  webUrl: v.optional(v.nullable(webUrlSchema), null),
  /** Absent means {@link DEFAULT_PROJECT_SKILLS}; an explicit `[]` means the team wants none. */
  skills: v.optional(v.array(skillSchema)),
  /** Any not yet on the org's list are added to it. */
  domains: v.optional(v.array(domainSchema), () => []),
})
export type CreateProject = v.InferOutput<typeof createProjectSchema>
/** What a CALLER sends: the schema before defaults, so the optional fields are optional. */
export type CreateProjectInput = v.InferInput<typeof createProjectSchema>

export const updateProjectSchema = v.partial(
  v.object({
    webUrl: v.nullable(webUrlSchema),
    skills: v.array(skillSchema),
    domains: v.array(domainSchema),
    mergeComments: v.nullable(mergeCommentListSchema),
    restrictDirectMerge: v.boolean(),
  }),
)
export type UpdateProject = v.InferOutput<typeof updateProjectSchema>

/** How many characters of a repository name a lookup needs before it asks the host. */
export const REPOSITORY_LOOKUP_MIN_QUERY = 3

/**
 * What the Add form asks while somebody types a repository name. The query is
 * held to a repository name's own alphabet, because it is spliced into the
 * host's search syntax and a space or a colon would add a qualifier.
 */
export const repositoryLookupQuerySchema = v.object({
  provider: vcsProviderSchema,
  owner: repoOwnerSchema,
  query: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(REPOSITORY_LOOKUP_MIN_QUERY),
    v.maxLength(100),
    v.regex(/^[A-Za-z0-9._-]+$/, 'A lookup is part of a repository name'),
  ),
})
export type RepositoryLookupQuery = v.InferOutput<typeof repositoryLookupQuerySchema>

export const repositoryCandidateSchema = v.object({
  /** The name as the host spells it, which is what the Add form registers. */
  repo: v.string(),
  description: v.nullable(v.string()),
  private: v.boolean(),
})
export type RepositoryCandidate = v.InferOutput<typeof repositoryCandidateSchema>

/**
 * The owner's repositories whose names match, as far as the credential in force
 * can see. `ownerFound: false` means the host has no such org, user or
 * namespace, and the list is then empty.
 */
export const repositoryLookupSchema = v.object({
  ownerFound: v.boolean(),
  repositories: v.array(repositoryCandidateSchema),
})
export type RepositoryLookup = v.InferOutput<typeof repositoryLookupSchema>
