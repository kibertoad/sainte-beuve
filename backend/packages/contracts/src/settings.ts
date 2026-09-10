import * as v from 'valibot'

// ---------------------------------------------------------------------------
// Integration configuration wire contracts.
//
// The credentials a deployment attaches to an integration, entered in the SPA
// instead of in the environment. The token itself is WRITE-ONLY: it is sealed by
// the deployment's cipher on the way in and never appears on a response, so the
// board cannot become a place to read a credential back out of.
//
// What a caller reads instead is the STATE of each integration, which is what a
// configuration screen actually needs: whether a token is stored, whether the
// deployment can still open it, and the last four characters so an operator can
// tell which token they are looking at.
// ---------------------------------------------------------------------------

/** The integrations a token can be stored for. cat-factory is the only one today. */
export const integrationIdSchema = v.picklist(['cat-factory'])
export type IntegrationId = v.InferOutput<typeof integrationIdSchema>

/**
 * `unreadable` is the state that earns this a picklist rather than a boolean: a
 * token sealed under an encryption key the deployment no longer has is stored and
 * useless at the same time, and an operator has to be told to re-enter it. Rolling
 * that into `configured: false` would hide a rotated key behind a screen that
 * looks merely empty.
 */
export const integrationTokenStateSchema = v.picklist(['absent', 'stored', 'unreadable'])
export type IntegrationTokenState = v.InferOutput<typeof integrationTokenStateSchema>

export const integrationTokenStatusSchema = v.object({
  integrationId: integrationIdSchema,
  state: integrationTokenStateSchema,
  /** The last four characters of the stored token. Null when there is nothing stored. */
  hint: v.nullable(v.string()),
  updatedAt: v.nullable(v.number()),
})
export type IntegrationTokenStatus = v.InferOutput<typeof integrationTokenStatusSchema>

/** Every known integration, stored or not, so the screen renders from one call. */
export const integrationSettingsSchema = v.object({
  integrations: v.array(integrationTokenStatusSchema),
})
export type IntegrationSettings = v.InferOutput<typeof integrationSettingsSchema>

export const setIntegrationTokenSchema = v.object({
  /**
   * The credential, in the clear, on its way to being sealed. The floor is a
   * length no real token is under, so a stray keystroke is refused at the
   * boundary rather than stored and later reported as a failing integration.
   */
  token: v.pipe(v.string(), v.trim(), v.minLength(8), v.maxLength(1024)),
})
export type SetIntegrationToken = v.InferOutput<typeof setIntegrationTokenSchema>
