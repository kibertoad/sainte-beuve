import { describe, expect, it } from 'vitest'
import { decideEnrolment, type EnrolmentInput } from './enrolment.js'

const ESTABLISHED: EnrolmentInput = {
  enrolment: 'invite',
  directorySize: 3,
  adoptedRole: null,
  adoptedEstablished: false,
  hasLinkedAdmin: true,
}

describe('decideEnrolment', () => {
  it('makes the first person into an empty org its admin', () => {
    // An org whose first member cannot configure it has no route that could fix
    // it, because promoting somebody is itself an admin's act.
    expect(decideEnrolment({ ...ESTABLISHED, directorySize: 0 })).toStrictEqual({
      admitted: true,
      role: 'admin',
    })
  })

  it('refuses a stranger where enrolment is by invitation', () => {
    expect(decideEnrolment(ESTABLISHED)).toStrictEqual({ admitted: false })
  })

  it('admits a stranger as a member where enrolment is open', () => {
    expect(decideEnrolment({ ...ESTABLISHED, enrolment: 'open' })).toStrictEqual({
      admitted: true,
      role: 'member',
    })
  })

  it('admits whoever holds a registered handle, under invitation', () => {
    expect(decideEnrolment({ ...ESTABLISHED, adoptedRole: 'member' })).toStrictEqual({
      admitted: true,
      role: 'member',
    })
  })

  it('does not hand admin to a handle once the org has an admin who signed in', () => {
    // A handle is a string an admin typed; the subject is the host's own id. A
    // typo, a released login or the wrong Bob would otherwise inherit the role
    // permanently, because the (provider, subject) link is then the wrong one.
    expect(decideEnrolment({ ...ESTABLISHED, adoptedRole: 'admin' })).toStrictEqual({
      admitted: true,
      role: 'member',
    })
  })

  it('lets the founding row keep its admin while no admin has proved themselves', () => {
    // The row `createOrg` seats for a named founder: there is no established
    // administrator to steal, and the org needs one.
    expect(
      decideEnrolment({ ...ESTABLISHED, adoptedRole: 'admin', hasLinkedAdmin: false }),
    ).toStrictEqual({ admitted: true, role: 'admin' })
  })

  it('caps an adopted row at member wherever the row said nothing stronger', () => {
    expect(
      decideEnrolment({ ...ESTABLISHED, enrolment: 'open', adoptedRole: 'member' }),
    ).toStrictEqual({ admitted: true, role: 'member' })
  })

  it('leaves an admin their role when they sign in on a second host', () => {
    // Their OWN row, already linked elsewhere: the cap is about an unclaimed
    // registration, and applying it here would demote an administrator for
    // connecting a GitLab account.
    expect(
      decideEnrolment({ ...ESTABLISHED, adoptedRole: 'admin', adoptedEstablished: true }),
    ).toStrictEqual({ admitted: true, role: 'admin' })
  })

  it('admits their second account by invitation, with no registration of its own', () => {
    // `invite` closes the door on who may JOIN. Somebody already inside is not
    // joining, and the only thing that reaches this branch is a row an admin
    // registered their handle on.
    expect(
      decideEnrolment({ ...ESTABLISHED, adoptedRole: 'member', adoptedEstablished: true }),
    ).toStrictEqual({ admitted: true, role: 'member' })
  })
})
