import * as v from 'valibot'

// ---------------------------------------------------------------------------
// The tenancy, and what a caller may do inside it.
//
// A session says WHO is calling. An org says what they may reach, and a role
// says what they may change. The two are separate slices on purpose: knowing who
// is calling is worth having on its own, and it was (see docs/auth.md), but
// until there is a boundary every authenticated caller sees the same board, the
// same directory and the same registry.
//
// An org is a COLUMN rather than a concept layered on top. Every row in the
// store belongs to exactly one, the repositories are bound to one before a
// service ever sees them, and there is no route anywhere that takes an org as an
// argument: a boundary a caller can name is a boundary a caller can cross.
// ---------------------------------------------------------------------------

/**
 * The handle an org is addressed by outside the store. Lowercase, because it
 * travels in a query string and two orgs differing only in case would be one
 * org to whoever is typing it and two to the store.
 */
export const orgSlugSchema = v.pipe(
  v.string(),
  v.trim(),
  v.toLowerCase(),
  v.minLength(1),
  v.maxLength(40),
  v.regex(
    /^[a-z0-9][a-z0-9-]*$/,
    'An org slug is lowercase letters, digits and dashes, and starts with a letter or a digit',
  ),
)
export type OrgSlug = v.InferOutput<typeof orgSlugSchema>

export const orgSchema = v.object({
  id: v.string(),
  slug: orgSlugSchema,
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  createdAt: v.number(),
})
export type Org = v.InferOutput<typeof orgSchema>

/**
 * The org a deployment that never asked for a second one is in.
 *
 * A FIXED id rather than a generated one, and that is what makes the boundary
 * land without a data migration anybody has to run: every row written before
 * this existed is backfilled to this id, every caller a deployment cannot place
 * in an org is placed in it, and a single-tenant deployment therefore behaves
 * exactly as it did. It is spelled unlike anything `ids.next()` produces (a
 * uuid on every facade), so nothing generated can collide with it.
 */
export const DEFAULT_ORG_ID = 'org_default'
export const DEFAULT_ORG_SLUG = 'default'

/**
 * The default org as a value, for a deployment whose `orgs` table is still
 * empty.
 *
 * Synthesised rather than written on first read: the org boundary must hold on
 * a GET, and a read that inserted a row would make `/api/v1/auth/session` — the
 * one route every page polls — a write on a store that may be read-only while a
 * restore is running. The row appears the first time somebody creates an org or
 * renames this one.
 */
export function defaultOrg(): Org {
  return { id: DEFAULT_ORG_ID, slug: DEFAULT_ORG_SLUG, name: 'Default', createdAt: 0 }
}

/**
 * What a caller may do inside their org.
 *
 * Two roles, because the gap slice 6a left open was exactly one distinction:
 * "can read the board" and "can revoke an API key" were the same permission. An
 * ADMIN configures the deployment — credentials, keys, the registry, the
 * directory — and a MEMBER uses it: the board, the workspace, attention, AI
 * reviews. Anything finer is a permission matrix, and a matrix nobody has asked
 * for yet is a matrix that will be wrong.
 */
export const roleSchema = v.picklist(['admin', 'member'])
export type Role = v.InferOutput<typeof roleSchema>

export const createOrgInputSchema = v.object({
  slug: orgSlugSchema,
  name: orgSchema.entries.name,
})
export type CreateOrgInput = v.InferOutput<typeof createOrgInputSchema>

export const orgListSchema = v.object({ orgs: v.array(orgSchema) })
export type OrgList = v.InferOutput<typeof orgListSchema>
