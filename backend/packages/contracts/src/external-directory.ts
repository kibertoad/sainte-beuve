import * as v from 'valibot'
import { externalRefSchema } from './external.js'
import { identityProviderSchema } from './identity.js'

// ---------------------------------------------------------------------------
// The people an external system lists for an org, and the groups they are in.
//
// Source-neutral on purpose: cat-factory's account directory is the first
// source (its users, workspaces and workspace memberships), and its gateway maps
// that shape onto this one. A reviewer or a team an external source put here
// carries an `ExternalRef` naming where it came from.
// ---------------------------------------------------------------------------

/** A source-control account the source knows a person by, keyed on the host's stable id. */
export const externalAccountSchema = v.object({
  provider: identityProviderSchema,
  /** The host's numeric user id, as a string: what a linked identity is keyed on. */
  subject: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  /** The handle the source last saw. Display and fallback matching only. */
  username: v.nullable(v.string()),
})
export type ExternalAccount = v.InferOutput<typeof externalAccountSchema>

export const externalPersonSchema = v.object({
  id: externalRefSchema.entries.id,
  name: v.nullable(v.string()),
  /** Empty when the source knows no host account for the person, who then cannot be matched. */
  accounts: v.array(externalAccountSchema),
})
export type ExternalPerson = v.InferOutput<typeof externalPersonSchema>

export const externalGroupSchema = v.object({
  id: externalRefSchema.entries.id,
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
})
export type ExternalGroup = v.InferOutput<typeof externalGroupSchema>

export const externalMembershipSchema = v.object({
  groupId: externalRefSchema.entries.id,
  personId: externalRefSchema.entries.id,
})
export type ExternalMembership = v.InferOutput<typeof externalMembershipSchema>

const entryBase = {
  source: externalRefSchema.entries.source,
  /** The source's own stable key for the entry. */
  key: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
  /** The entry's ordering position: a state with a lower `seq` than the held one is older. */
  seq: v.number(),
}

/**
 * One directory entry as an external source lists it. `record` is null once the
 * source dropped it; the row stays, so a late, older state cannot bring it back.
 */
export const externalDirectoryEntrySchema = v.variant('kind', [
  v.object({ ...entryBase, kind: v.literal('person'), record: v.nullable(externalPersonSchema) }),
  v.object({ ...entryBase, kind: v.literal('group'), record: v.nullable(externalGroupSchema) }),
  v.object({
    ...entryBase,
    kind: v.literal('membership'),
    record: v.nullable(externalMembershipSchema),
  }),
])
export type ExternalDirectoryEntry = v.InferOutput<typeof externalDirectoryEntrySchema>
export type ExternalDirectoryKind = ExternalDirectoryEntry['kind']
export const EXTERNAL_DIRECTORY_KINDS: readonly ExternalDirectoryKind[] = [
  'person',
  'group',
  'membership',
]

/** How an org's people and teams are kept in step with an external directory. */
export const peopleSyncSchema = v.object({
  /** People the source lists. */
  listed: v.number(),
  /** Of those, the ones a reviewer here follows. */
  linked: v.number(),
  /** Listed people with no GitHub or GitLab account at the source, so nobody here can be matched to them. */
  withoutAccount: v.number(),
})
export type PeopleSync = v.InferOutput<typeof peopleSyncSchema>
