import { defineApiContract } from '@toad-contracts/valibot'
import { createOrgInputSchema, orgListSchema, orgSchema } from '../orgs.js'
import { errorResponses } from './_shared.js'

// ---------------------------------------------------------------------------
// Org route contracts. See OrgController in @sainte-beuve/server.
//
// There is deliberately no route that READS another org and none that takes an
// org as an argument: which org a request is in is decided by the credential it
// arrived on, before any handler runs. These two are the operator's half —
// seeing which tenancies exist and making one — and both are admin-only.
//
// They sit under `/settings` with the credential routes rather than at
// `/api/v1/orgs`, because creating a tenancy is the same kind of act as minting
// a key, and the settings prefix is what the wildcard CORS default already stops
// at (see `allowedOrigin` in app.ts).
// ---------------------------------------------------------------------------

/** Every org on this deployment. Admin-only: a member has no use for the list. */
export const listOrgsContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/settings/orgs',
  responsesByStatusCode: { 200: orgListSchema, ...errorResponses },
})

/**
 * Make one.
 *
 * It answers with the org and nothing else, because the caller does not become a
 * member of it: the first person to SIGN IN to an org becomes its admin, which
 * is the only honest rule when the alternative is an org whose first member
 * cannot configure it. See `docs/orgs.md`.
 */
export const createOrgContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/settings/orgs',
  requestBodySchema: createOrgInputSchema,
  responsesByStatusCode: { 201: orgSchema, ...errorResponses },
})
