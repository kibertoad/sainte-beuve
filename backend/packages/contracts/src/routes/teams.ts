import { defineApiContract } from '@toad-contracts/valibot'
import { createTeamSchema, teamListSchema, teamSchema, updateTeamSchema } from '../teams.js'
import { errorResponses, singleStringParam } from './_shared.js'

// Team route contracts. See TeamController in @sainte-beuve/server. Every member
// may read the list and create a team they own; renaming, deleting or handing
// over a team is its owner's or an admin's.

const teamIdParams = singleStringParam('teamId')

export const listTeamsContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/teams',
  responsesByStatusCode: { 200: teamListSchema, ...errorResponses },
})

export const createTeamContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/teams',
  requestBodySchema: createTeamSchema,
  responsesByStatusCode: { 201: teamSchema, ...errorResponses },
})

export const updateTeamContract = defineApiContract({
  method: 'patch',
  requestPathParamsSchema: teamIdParams,
  pathResolver: ({ teamId }) => `/teams/${teamId}`,
  requestBodySchema: updateTeamSchema,
  responsesByStatusCode: { 200: teamSchema, ...errorResponses },
})

/** Answers with the list as it stands afterwards, like removing a project does. */
export const deleteTeamContract = defineApiContract({
  method: 'delete',
  requestPathParamsSchema: teamIdParams,
  pathResolver: ({ teamId }) => `/teams/${teamId}`,
  responsesByStatusCode: { 200: teamListSchema, ...errorResponses },
})
