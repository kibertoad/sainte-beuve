import * as v from 'valibot'
import { identityProviderSchema, viewerSchema } from './identity.js'
import { orgSchema, roleSchema } from './orgs.js'

// ---------------------------------------------------------------------------
// Who is calling, and on what authority.
//
// Two kinds of caller reach this API and they need different answers. A PERSON
// arrives in a browser, proves who they are on a source-control host, and is
// carried afterwards by a session cookie. A MACHINE arrives from CI or a script,
// holds a key somebody minted for it, and is nobody: it has no workspace, no
// three lists and no reviewer row.
//
// What is deliberately NOT here is the credential itself. A session token and an
// API key exist on the wire exactly twice — once on the way out of the flow that
// mints them, once on the way back in — and the store holds only a digest of
// each. So `sessionSchema` describes a session and carries no way to present
// one, and `issuedApiKeySchema` is the single place in the contracts where a
// secret appears at all.
// ---------------------------------------------------------------------------

/**
 * Whether this deployment insists on knowing who is calling.
 *
 * `open` is what every deployment ran before sessions existed and what local
 * mode still runs: no caller is refused for being anonymous, and the viewer
 * falls back to whoever the deployment's own source-control credential acts as.
 * `required` refuses an anonymous call to anything under `/api/v1` but the
 * sign-in routes themselves.
 *
 * It is a deployment's decision rather than something derived from what is
 * configured, because the two honest answers point opposite ways: deriving
 * `required` from "an OAuth client exists" would lock a laptop out of its own
 * board the day somebody configured a sign-in, and deriving `open` from
 * "nothing is configured" would leave a hosted deployment open because a
 * variable was mistyped. `/health` reports which one is in force, so the answer
 * is legible from outside the process.
 */
export const authModeSchema = v.picklist(['open', 'required'])
export type AuthMode = v.InferOutput<typeof authModeSchema>

/**
 * A session, as its holder can see it. There is no token here on purpose: the
 * value that presents this session was handed to the browser once, as a cookie,
 * and the store holds only its digest.
 */
export const sessionSchema = v.object({
  id: v.string(),
  /** The host the person proved themselves on, and its own stable id for them. */
  provider: identityProviderSchema,
  subject: v.string(),
  createdAt: v.number(),
  /** Last request this session was presented on. Rounded: see SessionService. */
  lastSeenAt: v.number(),
  /**
   * Absolute expiry, epoch ms. Absolute rather than sliding: a session that
   * renewed itself on every request would never end for the one caller that
   * matters here, a script holding a cookie it scraped out of a browser profile.
   */
  expiresAt: v.number(),
})
export type Session = v.InferOutput<typeof sessionSchema>

/**
 * Who this request is, in the three shapes it can be.
 *
 * A variant rather than a nullable viewer, because "nobody is signed in" and "a
 * machine is calling" are different states with different remedies, and a screen
 * that collapsed them would offer a sign-in button to a CI job's key.
 */
export const principalSchema = v.variant('kind', [
  v.object({ kind: v.literal('anonymous') }),
  v.object({
    kind: v.literal('session'),
    session: sessionSchema,
    /** The person behind it, so a screen needs no second call to name them. */
    viewer: viewerSchema,
  }),
  v.object({
    kind: v.literal('api_key'),
    keyId: v.string(),
    label: v.string(),
  }),
])
export type Principal = v.InferOutput<typeof principalSchema>

/**
 * What the SPA asks for before it renders anything: who I am, whether this
 * deployment cares, and which hosts it can sign me in with.
 *
 * One route rather than three, for the reason the connections read is one call:
 * a screen that assembled "am I signed in", "does it matter" and "what can I
 * click" from three routes would render a state that never existed at any single
 * moment.
 */
export const authStateSchema = v.object({
  mode: authModeSchema,
  principal: principalSchema,
  /**
   * The tenancy this request is in, and what the caller may do inside it.
   *
   * Beside the principal rather than inside it, because all three kinds of
   * caller have one: an anonymous caller on an `open` deployment is in the
   * default org, a key is in the org it was minted in, and a session is in the
   * org it was established in. A screen reads `role` to decide whether to draw
   * the Configuration screen at all, so it has to be answered for every caller
   * the guard let through rather than only for the ones with a reviewer row.
   */
  org: orgSchema,
  role: roleSchema,
  /**
   * The hosts a sign-in can actually be started on: an OAuth client is
   * configured for them AND this deployment can sign the round trip. Empty means
   * nobody can sign in here, which is the state a `required` deployment must not
   * be left in and the reason the screen says so rather than showing a dead
   * button.
   */
  signInProviders: v.array(identityProviderSchema),
})
export type AuthState = v.InferOutput<typeof authStateSchema>

/**
 * A key a machine calls with, as it sits in the directory. The key itself is not
 * here: it is shown once, when it is minted, and never again.
 */
export const apiKeySchema = v.object({
  id: v.string(),
  /** What it is for, typed by whoever minted it. The only way to tell two apart. */
  label: v.string(),
  /**
   * What the key may do in its org. Carried on the ROW rather than derived from
   * whoever minted it: a key outlives the person who made it, and a CI job that
   * silently inherited an operator's admin is how a build script comes to be
   * able to revoke the credentials it runs on.
   */
  role: roleSchema,
  /** The last four characters of the key, so a row can be matched to a secret store. */
  hint: v.string(),
  /** The reviewer who minted it, when a person did. Null for one the deployment carries. */
  createdBy: v.nullable(v.string()),
  createdAt: v.number(),
  /** When it was last presented, or null for one nothing has used. See ApiKeyService. */
  lastUsedAt: v.nullable(v.number()),
})
export type ApiKey = v.InferOutput<typeof apiKeySchema>

export const createApiKeyInputSchema = v.object({
  label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  /**
   * `member` unless the caller says otherwise, because most keys are a job that
   * reads the board and the safe default for a durable bearer credential is the
   * narrower one. Only an admin can mint either.
   */
  role: v.optional(roleSchema, 'member'),
})
export type CreateApiKeyInput = v.InferOutput<typeof createApiKeyInputSchema>

/**
 * A key, the one time it exists.
 *
 * The ONLY schema in the contracts that carries a secret, and it is the response
 * of exactly one route. Nothing reads it back: the store holds a digest, so a
 * caller who loses the value mints another rather than recovering this one.
 */
export const issuedApiKeySchema = v.object({
  key: apiKeySchema,
  /** Shown once. Copy it now, because this deployment cannot show it again. */
  token: v.string(),
})
export type IssuedApiKey = v.InferOutput<typeof issuedApiKeySchema>

/** The keys a deployment holds, newest first. */
export const apiKeyListSchema = v.object({ apiKeys: v.array(apiKeySchema) })
export type ApiKeyList = v.InferOutput<typeof apiKeyListSchema>
