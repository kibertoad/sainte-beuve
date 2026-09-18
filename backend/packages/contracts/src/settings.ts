import * as v from 'valibot'
import type { VcsProvider } from './vcs.js'

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
 * key belongs on this list: a sign-in produces a credential too, and it arrives
 * from a redirect rather than from a text input. Keeping the picklist to the
 * pasteable ones is what lets the write route refuse an unknown id at the
 * contract boundary, and what stops the Configuration screen from rendering a
 * "paste a token" field beside a credential nobody can paste. The sign-in
 * credentials are {@link vcsOauthCredentialKey}, reported through
 * {@link vcsConnectionSchema} instead.
 *
 * `slack-signing-secret` is on the list although nothing is ever CALLED with it:
 * it is what an inbound slash command is verified against, and it is here
 * because it is an ORG's credential rather than the deployment's. One Slack app
 * serves one tenancy, so the org that connected it is the org whose board its
 * commands act on — which is the whole of how a Slack command reaches a tenancy
 * that is not the default one. See `SLACK_ORG_WEBHOOK_PATH`.
 */
export const integrationIdSchema = v.picklist([
  'github-pat',
  'gitlab-pat',
  'slack-bot-token',
  'slack-signing-secret',
  'cat-factory',
])
export type IntegrationId = v.InferOutput<typeof integrationIdSchema>

// What each integration is CALLED, so a screen asking about one names a product
// rather than a store key: "the GitHub token" reads like a thing an operator
// has, where `github-pat` reads like a bug report. Private table and exported
// reader, the shape `vcsDisplayName` already uses.
const INTEGRATION_LABELS: Record<IntegrationId, string> = {
  'github-pat': 'GitHub token',
  'gitlab-pat': 'GitLab token',
  'slack-bot-token': 'Slack bot token',
  'slack-signing-secret': 'Slack signing secret',
  'cat-factory': 'cat-factory key',
}

/**
 * The integration as a person reads it. Falls back to the id, because the API is
 * versioned separately from the SPA and a deployment can serve a credential this
 * build has never heard of.
 */
export function integrationLabel(integrationId: string): string {
  return INTEGRATION_LABELS[integrationId as IntegrationId] ?? integrationId
}

/** The store keys a sign-in credential is held under, one per source-control host. */
export const vcsOauthCredentialKeySchema = v.picklist(['github-oauth', 'gitlab-oauth'])
export type VcsOauthCredentialKey = v.InferOutput<typeof vcsOauthCredentialKeySchema>

/**
 * The whole credential key space is derived here rather than spelled out at the
 * point of use, so a second host cannot arrive with a key invented in a service
 * that nothing else knows to clear.
 */
export function vcsOauthCredentialKey(provider: VcsProvider): VcsOauthCredentialKey {
  return provider === 'github' ? 'github-oauth' : 'gitlab-oauth'
}

/** The store key a pasted token for one host is held under. */
export function vcsPatCredentialKey(provider: VcsProvider): IntegrationId {
  return provider === 'github' ? 'github-pat' : 'gitlab-pat'
}

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
