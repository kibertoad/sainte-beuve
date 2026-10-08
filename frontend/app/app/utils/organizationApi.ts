import type {
  CreateOrgInputPayload,
  CreateReviewerInput,
  UpdateOrgInput,
  UpdateReviewer,
  UpdateTeam,
} from '@sainte-beuve/contracts'
import {
  createOrgContract,
  createReviewerContract,
  createTeamContract,
  deleteTeamContract,
  listOrgsContract,
  listReviewersContract,
  listTeamsContract,
  updateOrgContract,
  updateReviewerContract,
  updateTeamContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// The org and the people in it: the org itself (admin-only), its reviewer
// directory, and its teams (any member may read them and create one they own).
export function organizationCalls(call: ContractCaller) {
  return {
    listOrgs: () => call(listOrgsContract, {}),
    createOrg: (org: CreateOrgInputPayload) => call(createOrgContract, { body: org }),
    updateOrg: (patch: UpdateOrgInput) => call(updateOrgContract, { body: patch }),

    listReviewers: () => call(listReviewersContract, {}),
    createReviewer: (reviewer: CreateReviewerInput) =>
      call(createReviewerContract, { body: reviewer }),
    updateReviewer: (reviewerId: string, patch: UpdateReviewer) =>
      call(updateReviewerContract, { pathParams: { reviewerId }, body: patch }),

    listTeams: () => call(listTeamsContract, {}),
    /** Owned by the caller unless `ownerId` names somebody, which only an admin may. */
    createTeam: (name: string, ownerId?: string | null) =>
      call(createTeamContract, { body: ownerId === undefined ? { name } : { name, ownerId } }),
    updateTeam: (teamId: string, patch: UpdateTeam) =>
      call(updateTeamContract, { pathParams: { teamId }, body: patch }),
    deleteTeam: (teamId: string) => call(deleteTeamContract, { pathParams: { teamId } }),
  }
}
