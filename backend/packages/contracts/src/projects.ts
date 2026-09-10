import * as v from 'valibot'
import { skillSchema } from './reviewers.js'
import { projectRefSchema, vcsProviderSchema } from './vcs.js'

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

export const projectSchema = v.object({
  id: v.string(),
  provider: vcsProviderSchema,
  owner: projectRefSchema.entries.owner,
  repo: projectRefSchema.entries.repo,
  /**
   * The project's page on its host. Stored rather than derived: a self-hosted
   * GitLab has no address anything here could guess.
   */
  webUrl: v.nullable(v.pipe(v.string(), v.url())),
  /** The vocabulary an attention request on this project picks its skills from. */
  skills: v.array(skillSchema),
  createdAt: v.number(),
})
export type Project = v.InferOutput<typeof projectSchema>

export const createProjectSchema = v.object({
  provider: vcsProviderSchema,
  owner: projectRefSchema.entries.owner,
  repo: projectRefSchema.entries.repo,
  webUrl: v.optional(v.nullable(v.pipe(v.string(), v.url())), null),
  /** Absent means {@link DEFAULT_PROJECT_SKILLS}; an explicit `[]` means the team wants none. */
  skills: v.optional(v.array(skillSchema)),
})
export type CreateProject = v.InferOutput<typeof createProjectSchema>
/** What a CALLER sends: the schema before defaults, so the optional fields are optional. */
export type CreateProjectInput = v.InferInput<typeof createProjectSchema>

export const updateProjectSchema = v.partial(
  v.object({
    webUrl: v.nullable(v.pipe(v.string(), v.url())),
    skills: v.array(skillSchema),
  }),
)
export type UpdateProject = v.InferOutput<typeof updateProjectSchema>
