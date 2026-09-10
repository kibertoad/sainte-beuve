import { defineApiContract, withObjectKeys } from '@toad-contracts/valibot'
import * as v from 'valibot'
import {
  integrationIdSchema,
  integrationSettingsSchema,
  integrationTokenStatusSchema,
  setIntegrationTokenSchema,
} from '../settings.js'
import { errorResponses } from './_shared.js'

// ---------------------------------------------------------------------------
// Configuration route contracts. See SettingsController in @sainte-beuve/server.
// ---------------------------------------------------------------------------

/**
 * The path param is the id PICKLIST rather than a bare string: an unknown
 * integration is then refused by the contract validator with the accepted values
 * in the envelope, instead of reaching a service that has to invent the same
 * refusal.
 */
const integrationParams = withObjectKeys(v.object({ integrationId: integrationIdSchema }))

export const getIntegrationSettingsContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/settings/integrations',
  responsesByStatusCode: { 200: integrationSettingsSchema, ...errorResponses },
})

/** PUT, not POST: storing a token is idempotent, and a second call replaces the first. */
export const setIntegrationTokenContract = defineApiContract({
  method: 'put',
  requestPathParamsSchema: integrationParams,
  pathResolver: ({ integrationId }) => `/settings/integrations/${integrationId}/token`,
  requestBodySchema: setIntegrationTokenSchema,
  responsesByStatusCode: { 200: integrationTokenStatusSchema, ...errorResponses },
})

export const clearIntegrationTokenContract = defineApiContract({
  method: 'delete',
  requestPathParamsSchema: integrationParams,
  pathResolver: ({ integrationId }) => `/settings/integrations/${integrationId}/token`,
  responsesByStatusCode: { 200: integrationTokenStatusSchema, ...errorResponses },
})
