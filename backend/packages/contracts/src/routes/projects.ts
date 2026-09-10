import { defineApiContract } from '@toad-contracts/valibot'
import * as v from 'valibot'
import { createProjectSchema, projectSchema, updateProjectSchema } from '../projects.js'
import { errorResponses, singleStringParam } from './_shared.js'

// ---------------------------------------------------------------------------
// Project-registry route contracts. See ProjectController in
// @sainte-beuve/server.
// ---------------------------------------------------------------------------

const projectListSchema = v.object({ projects: v.array(projectSchema) })
const projectIdParams = singleStringParam('projectId')

export const listProjectsContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/projects',
  responsesByStatusCode: { 200: projectListSchema, ...errorResponses },
})

export const addProjectContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/projects',
  requestBodySchema: createProjectSchema,
  responsesByStatusCode: { 201: projectSchema, ...errorResponses },
})

export const updateProjectContract = defineApiContract({
  method: 'patch',
  requestPathParamsSchema: projectIdParams,
  pathResolver: ({ projectId }) => `/projects/${projectId}`,
  requestBodySchema: updateProjectSchema,
  responsesByStatusCode: { 200: projectSchema, ...errorResponses },
})

/**
 * Stop watching a project. The pull requests it contributed leave the workspace
 * with it; nothing on the board or in the commitment log is touched, because
 * those are promises people made and un-registering a repository is not a way
 * to withdraw one.
 */
export const removeProjectContract = defineApiContract({
  method: 'delete',
  requestPathParamsSchema: projectIdParams,
  pathResolver: ({ projectId }) => `/projects/${projectId}`,
  responsesByStatusCode: { 200: projectListSchema, ...errorResponses },
})
