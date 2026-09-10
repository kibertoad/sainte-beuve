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

/**
 * The integrations a token can be PASTED for.
 *
 * Every credential this deployment holds lives in one keyed store, but not every
 * key belongs on this list: a GitHub sign-in produces a credential too, and it
 * arrives from a redirect rather than from a text input. Keeping the picklist to
 * the pasteable ones is what lets the write route refuse an unknown id at the
 * contract boundary, and what stops the Configuration screen from rendering a
 * "paste a token" field beside a credential nobody can paste. The sign-in
 * credential is {@link GITHUB_OAUTH_CREDENTIAL_KEY}, reported through
 * {@link githubConnectionSchema} instead.
 */
export const integrationIdSchema = v.picklist(['github-pat', 'slack-bot-token', 'cat-factory'])
export type IntegrationId = v.InferOutput<typeof integrationIdSchema>

/**
 * The store key the GitHub sign-in credential is held under. Named here, beside
 * the pasteable ids, so the whole credential key space is one file: a second key
 * invented in a service is a key nothing else can find to clear.
 */
export const GITHUB_OAUTH_CREDENTIAL_KEY = 'github-oauth'

/**
 * `unreadable` is the state that earns this a picklist rather than a boolean: a
 * token sealed under an encryption key the deployment no longer has is stored and
 * useless at the same time, and an operator has to be told to re-enter it. Rolling
 * that into `configured: false` would hide a rotated key behind a screen that
 * looks merely empty.
 */
export const integrationTokenStateSchema = v.picklist(['absent', 'stored', 'unreadable'])
export type IntegrationTokenState = v.InferOutput<typeof integrationTokenStateSchema>

/**
 * Why a stored token cannot be opened. Three faults with three different fixes:
 * the deployment has no usable encryption key at all (`no_key`), the key it has
 * is not the one this token was sealed under (`key_mismatch`), or the stored
 * value is not an envelope this scheme wrote (`corrupt`). Rolled into one state
 * they would be reported as whichever the screen happened to name, which sends
 * an operator after a key that was never rotated.
 */
export const integrationTokenUnreadableReasonSchema = v.picklist([
  'no_key',
  'key_mismatch',
  'corrupt',
])
export type IntegrationTokenUnreadableReason = v.InferOutput<
  typeof integrationTokenUnreadableReasonSchema
>

export const integrationTokenStatusSchema = v.object({
  integrationId: integrationIdSchema,
  state: integrationTokenStateSchema,
  /** Set exactly when `state` is `unreadable`, so the screen names the actual fault. */
  unreadableReason: v.nullable(integrationTokenUnreadableReasonSchema),
  /**
   * Whether this row is the credential the deployment is currently AUTHENTICATING
   * with. Holding a credential and using it stay two different facts, for two
   * reasons that both survive the gateways being resolved per request: the rest
   * of an integration's configuration may be missing (a cat-factory key with no
   * base URL reaches nothing), and a credential can be SHADOWED by a stronger one
   * (a pasted GitHub token sits unused behind a configured GitHub App). A screen
   * reporting only "stored" would show both as configured while neither is what
   * the next request uses.
   */
  inUse: v.boolean(),
  /** The last four characters of the stored token. Null when there is nothing stored. */
  hint: v.nullable(v.string()),
  /** The account the credential belongs to, when the flow that stored it knew one. */
  subject: v.nullable(v.string()),
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
