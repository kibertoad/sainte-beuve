import * as v from 'valibot'
import { vcsProviderSchema } from './vcs.js'

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

/**
 * WHO MAY JOIN AN ORG, which before this was nobody's decision.
 *
 * `invite` is the default and the honest one: an account may take a directory
 * row an admin registered for it, and nothing else. Anyone else who completes a
 * sign-in is refused. `open` is what every org did before the flag existed —
 * any account a host will authorise becomes a member — and it is a deployment
 * saying that its OAuth client is scoped to its own people.
 *
 * It matters because a sign-in is not an act anybody here approves: on
 * github.com and gitlab.com any account can authorise any OAuth app, the client
 * id is public by construction, and `/health` advertises which hosts are
 * offered. Without a decision in front of it, everything a `member` may do — the
 * board, the directory of names and Slack ids, review creation, AI-review
 * dispatch — is available to whoever guesses an org slug.
 *
 * The one thing `invite` does NOT gate is the FOUNDING sign-in of an org with an
 * empty directory: an org whose first member cannot configure it is an org
 * nobody can use. `createOrg` takes a `founder` precisely so that window can be
 * closed before anybody is told the slug.
 */
export const orgEnrolmentSchema = v.picklist(['invite', 'open'])
export type OrgEnrolment = v.InferOutput<typeof orgEnrolmentSchema>

export const orgSchema = v.object({
  id: v.string(),
  slug: orgSlugSchema,
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  /**
   * OPTIONAL on the way in and always present on the way out, which is what
   * makes this land without a data migration: a row written before the flag
   * existed decodes as `invite`, and an org nobody decided about is closed
   * rather than open. See `orgEnrolmentSchema`.
   */
  enrolment: v.optional(orgEnrolmentSchema, 'invite'),
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
  return {
    id: DEFAULT_ORG_ID,
    slug: DEFAULT_ORG_SLUG,
    name: 'Default',
    // `invite`, like every other org. A fresh deployment still admits its first
    // sign-in — the directory is empty, and that is the founder — and everybody
    // after them is somebody an admin registered.
    enrolment: 'invite',
    createdAt: 0,
  }
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

/**
 * The account that founds an org, named by whoever creates it.
 *
 * By HANDLE, because that is the only thing an operator can know before the
 * person has ever signed in: the host's own stable subject appears at the first
 * sign-in and not a moment earlier. So this is a claim to be taken, not proof —
 * which is why the row it seats is the only one adoption is ever allowed to hand
 * `admin` to (see `decideEnrolment` in @sainte-beuve/reviewers), and why naming
 * one is worth the trouble: it closes the window in which whoever guesses the
 * slug first becomes the org's administrator.
 *
 * The provider is the SOURCE-CONTROL host rather than `identityProviderSchema`,
 * on both counts that matter. It is what the field means: the handle is written
 * into the founding row's `VcsHandles`, which is keyed by `VcsProvider`, and the
 * day `identity.ts` grows an `oidc` member the two must not silently coincide.
 * It is also what keeps this module a LEAF: `identity.ts` reads `reviewers.ts`,
 * which reads `roleSchema` from here, so importing it back would close a cycle
 * whose every member initialises a `const` at module scope — which under ESM is
 * a `ReferenceError` on import, in every entry order, taking the whole contracts
 * package and therefore every runtime with it. `vcs.ts` imports nothing local.
 */
export const orgFounderSchema = v.object({
  provider: vcsProviderSchema,
  handle: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
})
export type OrgFounder = v.InferOutput<typeof orgFounderSchema>

export const createOrgInputSchema = v.object({
  slug: orgSlugSchema,
  name: orgSchema.entries.name,
  /** Defaults to `invite`: an org nobody decided about is closed. */
  enrolment: v.optional(orgEnrolmentSchema, 'invite'),
  /**
   * The founding admin. Absent leaves the org with an empty directory, and the
   * first account to complete a sign-in to it becomes its admin — which is a
   * race with whoever else knows the slug.
   */
  founder: v.optional(v.nullable(orgFounderSchema), null),
})
export type CreateOrgInput = v.InferOutput<typeof createOrgInputSchema>
/** What a CALLER sends: the schema before defaults, so the optional fields are optional. */
export type CreateOrgInputPayload = v.InferInput<typeof createOrgInputSchema>

/**
 * What an admin may change about their own org afterwards.
 *
 * `enrolment` is the reason this route exists: a deployment whose OAuth client
 * IS scoped to its own people can open the door, and one that finds it open can
 * close it, without either being a redeploy.
 */
export const updateOrgInputSchema = v.partial(
  v.object({ name: orgSchema.entries.name, enrolment: orgEnrolmentSchema }),
)
export type UpdateOrgInput = v.InferOutput<typeof updateOrgInputSchema>

export const orgListSchema = v.object({ orgs: v.array(orgSchema) })
export type OrgList = v.InferOutput<typeof orgListSchema>
