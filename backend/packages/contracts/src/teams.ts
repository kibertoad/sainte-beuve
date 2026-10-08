import * as v from 'valibot'

// ---------------------------------------------------------------------------
// Teams: the list a reviewer's `team` is picked from, kept per org.
//
// A reviewer refers to a team by NAME, which is what the same-team gate on an
// attention request compares (case-insensitively). Names are therefore unique
// within an org regardless of case, and renaming a team renames it on every
// reviewer in it.
// ---------------------------------------------------------------------------

export const teamNameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))

export const teamSchema = v.object({
  id: v.string(),
  name: teamNameSchema,
  /**
   * The reviewer who may rename, delete or hand over this team besides an
   * admin. Null for a team nobody owns, which only an admin manages.
   */
  ownerId: v.nullable(v.string()),
  createdAt: v.number(),
})
export type Team = v.InferOutput<typeof teamSchema>

export const createTeamSchema = v.object({
  name: teamNameSchema,
  /** Absent makes the caller the owner. Naming anybody else is an admin's call. */
  ownerId: v.optional(v.nullable(v.string())),
})
export type CreateTeam = v.InferOutput<typeof createTeamSchema>

/** A rename, a transfer of ownership, or both. */
export const updateTeamSchema = v.partial(
  v.object({ name: teamNameSchema, ownerId: v.nullable(v.string()) }),
)
export type UpdateTeam = v.InferOutput<typeof updateTeamSchema>

export const teamListSchema = v.object({ teams: v.array(teamSchema) })
export type TeamList = v.InferOutput<typeof teamListSchema>
