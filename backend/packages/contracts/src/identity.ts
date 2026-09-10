import * as v from 'valibot'
import { reviewerSchema } from './reviewers.js'

// ---------------------------------------------------------------------------
// Who the person in front of the workspace is.
//
// The canonical person is the REVIEWER row: it already carries a generated id,
// a display name, the skills the router matches on and the team the attention
// gate reads, and inventing a second `user` table beside it would leave two
// rows to keep in step for one human being.
//
// What is deliberately NOT the identity is the GitHub login. A login is a
// display handle: it is renameable, it is reused by whoever takes the name next,
// and it names nothing on a second host. So a person carries a SET of linked
// identities keyed on `(provider, subject)`, where the subject is the host's own
// stable id, and the login rides along as metadata. That is what lets one person
// hold a GitHub and a GitLab account, keep their workspace across a rename, and
// exist at all before either is connected.
// ---------------------------------------------------------------------------

/**
 * Where a linked identity came from.
 *
 * Its own picklist rather than an alias of `vcsProviderSchema`, even though the
 * members coincide today: a login provider and a source-control host are
 * different questions, and the day this grows an `oidc` or a `password`
 * identity, that member must not imply an adapter that can list pull requests.
 */
export const identityProviderSchema = v.picklist(['github', 'gitlab'])
export type IdentityProvider = v.InferOutput<typeof identityProviderSchema>

export const linkedIdentitySchema = v.object({
  provider: identityProviderSchema,
  /**
   * The host's stable id for the account, as a string: GitHub's numeric user id,
   * GitLab's numeric user id. Stable across a rename, which is the whole point of
   * keying on it.
   */
  subject: v.string(),
  /** The handle at the time it was last seen. Display only: it can change under us. */
  username: v.nullable(v.string()),
  linkedAt: v.number(),
})
export type LinkedIdentity = v.InferOutput<typeof linkedIdentitySchema>

/**
 * The person the workspace is being rendered for, and the accounts they are
 * known by. The identities are on the wire because the three pull-request lists
 * are matched on handles, and a screen that shows "nothing awaits your review"
 * has to be able to say which account it looked for.
 */
export const viewerSchema = v.object({
  reviewer: reviewerSchema,
  identities: v.array(linkedIdentitySchema),
})
export type Viewer = v.InferOutput<typeof viewerSchema>
