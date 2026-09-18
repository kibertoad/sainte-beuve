import type { OrgEnrolment, Role } from '@sainte-beuve/contracts'

/**
 * WHETHER A HOST ACCOUNT MAY BECOME A PERSON IN THIS ORG, and with what role.
 *
 * A pure decision over four facts, beside the other decisions rather than inside
 * the sign-in, because it is the one that was never made anywhere: a sign-in
 * used to be its own authorisation. On github.com and gitlab.com any account can
 * authorise any OAuth app and the client id is public, so "completed the round
 * trip" says only that somebody has an account on a host — which, before this,
 * was enough to read an org's board and its directory, create reviews and spend
 * its AI-review budget.
 *
 * The three ways in, in the order they are asked:
 *
 *  1. THE FOUNDER. An org with nobody in it admits its first sign-in as an
 *     admin, because an org whose first member cannot configure it has no route
 *     that could fix it — promoting somebody is itself an admin's act. It is a
 *     race with whoever else knows the slug, and it is bounded: it can happen
 *     only while the org is empty, and `createOrg` takes a `founder` precisely
 *     so a deployment need not leave that window open at all.
 *  2. AN INVITATION. A directory row registered by hand, matched on the handle,
 *     and not yet claimed by any account. This is the documented workflow — a
 *     team registers its people long before they sign in — and it is what
 *     `invite` means.
 *  3. OPEN ENROLMENT. Any account the host authorised, as a member. That is what
 *     every org did before this existed, and it is now something a deployment
 *     says about itself rather than something it discovers.
 *
 * ADOPTION DOES NOT CONFER `admin` once the org has an admin who has actually
 * signed in. A handle is a string an admin typed and a subject is the host's own
 * id for an account, so a pre-registered row is a claim waiting to be taken: a
 * typo, a released-and-re-registered login, or simply the wrong Bob otherwise
 * inherits the role permanently, because the `(provider, subject)` link is then
 * the wrong subject. The founding row is the exception the ordering makes
 * possible — while no admin has proved themselves, there is no established
 * administrator to steal.
 */
export interface EnrolmentInput {
  /** The org's own decision about who may join. */
  enrolment: OrgEnrolment
  /** How many people the directory holds. Zero is the founding sign-in. */
  directorySize: number
  /** The role on the unclaimed row this account's handle matches, if any. */
  adoptedRole: Role | null
  /** Whether an admin of this org has ever signed in. */
  hasLinkedAdmin: boolean
}

/** Admitted, with the role the newcomer gets; or not, and the caller refuses. */
export type EnrolmentDecision = { admitted: false } | { admitted: true; role: Role }

const REFUSED: EnrolmentDecision = { admitted: false }

export function decideEnrolment(input: EnrolmentInput): EnrolmentDecision {
  if (input.directorySize === 0) return { admitted: true, role: 'admin' }
  if (input.adoptedRole !== null) return { admitted: true, role: adoptedRole(input) }
  return input.enrolment === 'open' ? { admitted: true, role: 'member' } : REFUSED
}

/** The pre-registered role, capped at `member` once the org has a real admin. */
function adoptedRole(input: EnrolmentInput): Role {
  if (input.adoptedRole !== 'admin') return 'member'
  return input.hasLinkedAdmin ? 'member' : 'admin'
}
