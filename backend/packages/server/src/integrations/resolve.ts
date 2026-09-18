import type {
  IntegrationId,
  VcsAuthMethod,
  VcsOauthCredentialKey,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { DEFAULT_ORG_ID, vcsOauthCredentialKey, vcsPatCredentialKey } from '@sainte-beuve/contracts'
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
  return resolveVcsAsPerson(container, provider)
}

/**
 * The credential in force for one host that acts as a PERSON: a sign-in, then a
 * pasted token, then the environment's own.
 *
 * The App step of the precedence is missing on purpose, and this is not a
 * shortcut: an installation token identifies nobody (`identify()` answers null
 * without a request), so asking `resolveVcs` who is looking answers "nobody" on
 * a deployment that holds an App AND a sign-in. Every route that needs a viewer
 * would then 503 with a message telling the operator to sign in, which is the
 * thing they already did, while their stored credential sat unreachable.
 *
 * Which credential a call is MADE with is a different question, and `resolveVcs`
 * is still the answer to it: the App is the stronger credential for reaching a
 * repository, it is just not a person.
 */
async function resolveVcsAsPerson(
  container: AppContainer,
  provider: VcsProvider,
): Promise<Resolved<VcsGateway, VcsAuthMethod> | null> {
  const signedIn = await gatewayFromStored(container, provider, vcsOauthCredentialKey(provider))
  if (signedIn !== null) return { gateway: signedIn, source: 'oauth' }

  const pasted = await gatewayFromStored(container, provider, vcsPatCredentialKey(provider))
  if (pasted !== null) return { gateway: pasted, source: 'pat' }

  const fromEnvironment = container.vcs[provider]
  return fromEnvironment === null ? null : { gateway: fromEnvironment, source: 'environment' }
}

/**
 * The resolutions made while answering ONE request, so a call chain that needs
 * the same host twice opens its sealed credential once.
 *
 * A workspace read needs GitHub for the viewer and again for the sweep, and
 * every resolution is an HKDF derivation plus an AES-GCM open. Deliberately not
 * cached on the container: the Node facade builds one container at boot, so a
 * cache with that lifetime would keep answering with the token a Configuration
 * screen has already replaced, which is the property `resolveVcs` runs per
 * request to protect.
 *
 * Only the person chain is memoised. `vcsAsApp` is a lookup of a gateway the
 * factory built once, so there is nothing there to save.
 */
export class VcsResolutions {
  private readonly asPersonByProvider = new Map<
    VcsProvider,
    Promise<Resolved<VcsGateway, VcsAuthMethod> | null>
  >()

  constructor(private readonly container: AppContainer) {}

  /** The gateway calls to this host are made with. See {@link resolveVcs}. */
  async acting(provider: VcsProvider): Promise<Resolved<VcsGateway, VcsAuthMethod> | null> {
    const asApp = this.container.gateways?.vcsAsApp(provider) ?? null
    if (asApp !== null) return { gateway: asApp, source: 'app' }
    return this.asPerson(provider)
  }

  /** The gateway that can say who is looking. See {@link resolveVcsAsPerson}. */
  async asPerson(provider: VcsProvider): Promise<Resolved<VcsGateway, VcsAuthMethod> | null> {
    const pending =
      this.asPersonByProvider.get(provider) ?? resolveVcsAsPerson(this.container, provider)
    this.asPersonByProvider.set(provider, pending)
    return pending
  }
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

/**
 * Whether the DEPLOYMENT'S OWN Slack app is this container's to use.
 *
 * One Slack app serves one tenancy, and the app `SLACK_BOT_TOKEN`,
 * `SLACK_SIGNING_SECRET` and `SLACK_CHANNEL_ID` describe is the deployment's —
 * which is to say the default org's. Every one of the three is therefore
 * withheld from a named org, and the rule lives here once rather than three
 * times, because the three of them only make sense together: a named org that
 * could borrow the bot token but not the secret would still announce its
 * reviews through a workspace it does not own.
 *
 * What lending any of them would cost is a tenancy boundary. The secret is the
 * loudest — anybody who could sign for the deployment's Slack app could act on
 * every org by writing a slug in a URL — and the other two leak in the quieter
 * direction: a named org's review titles, URLs and reviewer names posted by the
 * deployment's bot, into the deployment's channel, where the default org reads
 * them. A named org connects its own Slack app or has no Slack at all.
 *
 * It is also what keeps every deployment that predates the boundary working
 * unchanged: such a deployment is entirely inside the default org, so the
 * deployment's Slack app is its org's Slack app.
 */
function deploymentSlackIsOurs(container: AppContainer): boolean {
  return container.orgId === DEFAULT_ORG_ID
}

/**
 * The Slack bot token in force: this org's stored one, else the deployment's own
 * where that is this org's to use. See {@link deploymentSlackIsOurs}.
 */
export async function resolveChat(
  container: AppContainer,
): Promise<Resolved<ChatGateway, CredentialSource> | null> {
  const stored = await openCredential(container, 'slack-bot-token')
  if (stored !== null && container.gateways !== null) {
    return { gateway: container.gateways.chat(stored), source: 'stored' }
  }
  if (!deploymentSlackIsOurs(container)) return null
  return container.chat === null ? null : { gateway: container.chat, source: 'environment' }
}

/**
 * The channel this org announces new reviews in, which a named org does not have
 * one of yet.
 *
 * `SLACK_CHANNEL_ID` is a channel in the deployment's own workspace, so it is
 * the default org's channel and nobody else's — see {@link deploymentSlackIsOurs}.
 * A named org with its own Slack app therefore announces nowhere until it has a
 * channel of its own, which is a placeholder in the plan rather than a silence
 * that can be mistaken for one: the DMs its reminders send still go out over its
 * own bot, and the Configuration screen says which half is off.
 */
export function announcementChannel(container: AppContainer): string | null {
  return deploymentSlackIsOurs(container) ? container.slack.announcementChannelId : null
}

/** A resolved secret and where it came from. Beside {@link Resolved}, for a credential nothing is called with. */
export interface ResolvedSecret {
  secret: string
  source: CredentialSource
}

/**
 * The secret an inbound Slack request is verified against, for the org this
 * container is bound to.
 *
 * The org's OWN stored secret first, because that is what makes a slash command
 * reach a tenancy that is not the default one: one Slack app serves one org, and
 * the secret it signs with is what proves a delivery belongs there.
 *
 * The deployment's `SLACK_SIGNING_SECRET` is the fallback FOR THE DEFAULT ORG
 * ALONE, by the rule {@link deploymentSlackIsOurs} states for all three halves
 * of the deployment's Slack app. Of the three this is the one where lending
 * would be an escalation rather than a leak: anybody who can post a signed
 * command to this deployment could act on any org's board by naming its slug in
 * the URL, which is exactly what placing the delivery by URL would otherwise
 * cost. A named org with nothing stored is refused.
 */
export async function resolveSlackSigningSecret(
  container: AppContainer,
): Promise<ResolvedSecret | null> {
  const stored = await openCredential(container, 'slack-signing-secret')
  if (stored !== null) return { secret: stored, source: 'stored' }
  if (!deploymentSlackIsOurs(container)) return null
  const fromEnvironment = container.slack.signingSecret
  return fromEnvironment === null ? null : { secret: fromEnvironment, source: 'environment' }
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
