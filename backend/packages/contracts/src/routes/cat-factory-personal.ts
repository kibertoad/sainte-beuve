import { defineApiContract } from '@toad-contracts/valibot'
import {
  catFactoryPersonalSchema,
  setCatFactoryPersonalKeySchema,
} from '../cat-factory-personal.js'
import { errorResponses } from './_shared.js'

// The caller's own cat-factory key. Under `/me` rather than `/settings`: a
// member stores their own, and an admin cannot read or set somebody else's.

export const getCatFactoryPersonalContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/me/cat-factory',
  responsesByStatusCode: { 200: catFactoryPersonalSchema, ...errorResponses },
})

/** PUT, not POST: storing a key is idempotent, and a second call replaces the first. */
export const setCatFactoryPersonalKeyContract = defineApiContract({
  method: 'put',
  pathResolver: () => '/me/cat-factory/key',
  requestBodySchema: setCatFactoryPersonalKeySchema,
  responsesByStatusCode: { 200: catFactoryPersonalSchema, ...errorResponses },
})

export const clearCatFactoryPersonalKeyContract = defineApiContract({
  method: 'delete',
  pathResolver: () => '/me/cat-factory/key',
  responsesByStatusCode: { 200: catFactoryPersonalSchema, ...errorResponses },
})
