import type {
  IntegrationId,
  VcsAuthMethod,
  VcsOauthCredentialKey,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { vcsOauthCredentialKey, vcsPatCredentialKey } from '@sainte-beuve/contracts'
import {
  type AiReviewGateway,
  type ChatGateway,
  getErrorMessage,
  isSecretDecryptError,
  type VcsGateway,
} from '@sainte-beuve/kernel'
import type { AppContainer } from '../container.js'

/**
 * Which credential each integration is authenticating with RIGHT NOW.
 *
 * This is the join the Configuration screen exists to make honest. A credential
 * can be stored and not used, for two reasons that both matter to whoever is
 * looking at the screen: the rest of the integration's configuration may be
 * missing, or a stronger credential may be shadowing it. So resolution reports
 * the SOURCE alongside the gateway rather than just handing back a gateway, and
 * the `inUse` flag on a token's status is that answer rather than a guess.
 *
 * Resolution runs per request. It has to: a token entered in the SPA has to take
 * effect without a redeploy, and on the Worker the container is built per request
 * anyway. The cost is at most one HKDF derivation and one AES-GCM open per
 * integration, against an in-memory row.
 */

/** A resolved gateway and where its credential came from. */
export interface Resolved<TGateway, TSource> {
  gateway: TGateway
  source: TSource
}

/**
 * Whether a capability is authenticating with a credential somebody stored on the
 * board, or with the one the deployment's own configuration carries.
 */
export type CredentialSource = 'stored' | 'environment'

/**
 * The credential in force for one source-control host, by the precedence
 * `vcsAuthMethodSchema` documents: an app, then a sign-in, then a pasted token,
 * then the environment.
 *
 * Every step can answer null on its own, and not only for want of a credential:
 * a build with no adapter for the host has no factory member to call, so a
 * stored GitLab token on a deployment that wired only GitHub resolves to
 * nothing rather than to a gateway that cannot be built.
 */
export async function resolveVcs(
  container: AppContainer,
  provider: VcsProvider,
): Promise<Resolved<VcsGateway, VcsAuthMethod> | null> {
  const asApp = container.gateways?.vcsAsApp(provider) ?? null
  if (asApp !== null) return { gateway: asApp, source: 'app' }

  const signedIn = await gatewayFromStored(container, provider, vcsOauthCredentialKey(provider))
  if (signedIn !== null) return { gateway: signedIn, source: 'oauth' }

  const pasted = await gatewayFromStored(container, provider, vcsPatCredentialKey(provider))
  if (pasted !== null) return { gateway: pasted, source: 'pat' }

  const fromEnvironment = container.vcs[provider]
  return fromEnvironment === null ? null : { gateway: fromEnvironment, source: 'environment' }
}

/** A gateway built from one stored credential, or null when there is no usable pair of the two. */
async function gatewayFromStored(
  container: AppContainer,
  provider: VcsProvider,
  key: IntegrationId | VcsOauthCredentialKey,
): Promise<VcsGateway | null> {
  const token = await openCredential(container, key)
  if (token === null) return null
  return container.gateways?.vcsFromToken(provider, token) ?? null
}

/** The Slack bot token in force: a stored one, else the deployment's own. */
export async function resolveChat(
  container: AppContainer,
): Promise<Resolved<ChatGateway, CredentialSource> | null> {
  const stored = await openCredential(container, 'slack-bot-token')
  if (stored !== null && container.gateways !== null) {
    return { gateway: container.gateways.chat(stored), source: 'stored' }
  }
  return container.chat === null ? null : { gateway: container.chat, source: 'environment' }
}

/**
 * The cat-factory key in force. A stored key can still resolve to nothing: the
 * gateway also needs a base URL and a service id, which are deployment
 * configuration rather than credentials, and the factory answers null without
 * them.
 */
export async function resolveAiReview(
  container: AppContainer,
): Promise<Resolved<AiReviewGateway, CredentialSource> | null> {
  const stored = await openCredential(container, 'cat-factory')
  const fromStored = stored === null ? null : (container.gateways?.aiReview(stored) ?? null)
  if (fromStored !== null) return { gateway: fromStored, source: 'stored' }
  return container.aiReview === null ? null : { gateway: container.aiReview, source: 'environment' }
}

/**
 * The plaintext of one stored credential, or null when there is none this
 * deployment can open.
 *
 * An envelope that will not open is logged and treated as absent rather than
 * thrown: the deployment falls back to whatever is configured below it, which is
 * how a rotated encryption key degrades to "GitHub still works through the
 * environment" instead of to a board that 500s. The Configuration screen is
 * where the fault is REPORTED, from the envelope's key id, with the instruction
 * that fixes it.
 */
export async function openCredential(
  container: AppContainer,
  key: IntegrationId | VcsOauthCredentialKey,
): Promise<string | null> {
  const { secrets, repositories, logger } = container
  if (secrets === null) return null
  const row = await repositories.integrationTokens.get(key)
  if (row === null) return null
  try {
    return await secrets.decrypt(row.sealed, key)
  } catch (err) {
    logger.warn(
      { integrationId: key, reason: isSecretDecryptError(err) ? err.failure : 'unknown' },
      `a stored credential could not be opened: ${getErrorMessage(err)}`,
    )
    return null
  }
}
