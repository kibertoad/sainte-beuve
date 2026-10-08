import { defineApiContract } from '@toad-contracts/valibot'
import { capabilitiesSchema } from '../capabilities.js'
import { errorResponses } from './_shared.js'

export const getCapabilitiesContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/capabilities',
  responsesByStatusCode: { 200: capabilitiesSchema, ...errorResponses },
})
