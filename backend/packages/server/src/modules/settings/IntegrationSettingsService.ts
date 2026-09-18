import type {
  IntegrationId,
  IntegrationTokenStatus,
  IntegrationTokenUnreadableReason,
  VcsAuthMethod,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { integrationIdSchema, vcsPatCredentialKey } from '@sainte-beuve/contracts'
import type { StoredIntegrationToken } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { hintOf } from '../../integrations/credentials.js'
import {
  type CredentialSource,
  resolveAiReview,
  resolveChat,
  resolveSlackSigningSecret,
  resolveVcs,
} from '../../integrations/resolve.js'

/**
 * The credentials a deployment attaches to its integrations, entered in the SPA
 * rather than in the environment.
 *
 * A token goes in through the cipher and never comes back out: what the screen
 * reads is a STATE per integration, and the only way to change a stored token is
 * to replace it. The state is decided from the envelope's key id rather than by
 * opening it, so a status read holds no credential: a key that was rotated
 * leaves a token stored and unusable, and the screen has to report that without
 * decrypting every credential the deployment holds on a read-only path.
 */

const NO_KEY =
  'Storing an integration token needs an encryption key: set SETTINGS_ENCRYPTION_KEY on the deployment'
const KEY_REJECTED =
  'Storing an integration token needs a usable encryption key, and SETTINGS_ENCRYPTION_KEY was refused'

/**
 * Which credential each capability is actually authenticating with, read once per
 * request rather than per row: the answer for one GitHub credential depends on
 * whether another shadows it, so it cannot be decided a row at a time.
 */
interface ActiveCredentials {
  vcs: Record<VcsProvider, VcsAuthMethod | null>
  chat: CredentialSource | null
  slackSigning: CredentialSource | null
  aiReview: CredentialSource | null
}

export class IntegrationSettingsService {
  constructor(private readonly container: AppContainer) {}

  /** Every known integration, stored or not, so the screen renders from one call. */
  async list(): Promise<IntegrationTokenStatus[]> {
    const [stored, active] = await Promise.all([
      this.container.repositories.integrationTokens.list(),
      this.activeCredentials(),
    ])
    const byId = new Map(stored.map((row) => [row.integrationId, row]))
    return Promise.all(
      integrationIdSchema.options.map((id) => this.statusOf(id, byId.get(id) ?? null, active)),
    )
  }

  async setToken(integrationId: IntegrationId, token: string): Promise<IntegrationTokenStatus> {
    const cipher = requireCapability(this.container.secrets, this.noCipherMessage())
    const stored = await this.container.repositories.integrationTokens.put({
      integrationId,
      // Sealed AGAINST the integration id: the envelope opens for this row and
      // for no other, so a value copied between rows cannot become a credential
      // the wrong gateway authenticates with.
      sealed: await cipher.encrypt(token, integrationId),
      hint: hintOf(token),
      subject: await this.subjectOf(integrationId, token),
      updatedAt: this.container.clock.now(),
    })
    // Readable by construction: it was sealed by the cipher that just ran. The
    // active credentials are re-read because this write may have CHANGED them.
    return {
      integrationId,
      state: 'stored',
      unreadableReason: null,
      inUse: inUse(integrationId, await this.activeCredentials()),
      hint: stored.hint,
      subject: stored.subject,
      updatedAt: stored.updatedAt,
    }
  }

  /**
   * Clearing needs no cipher. A deployment whose key is gone must still be able
   * to drop the token that key sealed, or the only way out of a rotation is a
   * store surgery.
   */
  async clearToken(integrationId: IntegrationId): Promise<IntegrationTokenStatus> {
    await this.container.repositories.integrationTokens.delete(integrationId)
    return this.absent(integrationId)
  }

  /**
   * Who a credential belongs to, when storing it is also the moment that can be
   * found out. A pasted source-control token is checked against the host's own
   * "who am I", which does two things worth the round trip: the screen can then
   * say which account is connected, and a token the host refuses fails the
   * write instead of being stored and reported as configured until the next
   * assignment quietly fails.
   *
   * Every other credential returns null, because nothing on their ports answers
   * the question. A deployment with no gateway factory (a suite, or a facade that
   * wired no adapters) also returns null rather than refusing the write: the
   * store is the capability being exercised, not the host.
   */
  private async subjectOf(integrationId: IntegrationId, token: string): Promise<string | null> {
    const provider = providerOfPat(integrationId)
    const gateway =
      provider === null ? null : (this.container.gateways?.vcsFromToken(provider, token) ?? null)
    if (gateway === null) return null
    return (await gateway.identify())?.username ?? null
  }

  private async activeCredentials(): Promise<ActiveCredentials> {
    const [github, gitlab, chat, slackSigning, aiReview] = await Promise.all([
      resolveVcs(this.container, 'github'),
      resolveVcs(this.container, 'gitlab'),
      resolveChat(this.container),
      resolveSlackSigningSecret(this.container),
      resolveAiReview(this.container),
    ])
    return {
      vcs: { github: github?.source ?? null, gitlab: gitlab?.source ?? null },
      chat: chat?.source ?? null,
      slackSigning: slackSigning?.source ?? null,
      aiReview: aiReview?.source ?? null,
    }
  }

  /**
   * Nothing stored, and therefore nothing in use: every id's answer to `inUse` is
   * "this row is the one in force", which an absent row cannot be. Stated as a
   * literal rather than routed through the lookup, so the two cannot disagree.
   */
  private absent(integrationId: IntegrationId): IntegrationTokenStatus {
    return {
      integrationId,
      state: 'absent',
      unreadableReason: null,
      inUse: false,
      hint: null,
      subject: null,
      updatedAt: null,
    }
  }

  private async statusOf(
    integrationId: IntegrationId,
    row: StoredIntegrationToken | null,
    active: ActiveCredentials,
  ): Promise<IntegrationTokenStatus> {
    if (row === null) return this.absent(integrationId)
    const unreadableReason = await this.unreadableReason(integrationId, row.sealed)
    return {
      integrationId,
      state: unreadableReason === null ? 'stored' : 'unreadable',
      unreadableReason,
      inUse: inUse(integrationId, active),
      hint: row.hint,
      subject: row.subject,
      updatedAt: row.updatedAt,
    }
  }

  /** Why this deployment could not open the stored envelope, or null when it can. */
  private async unreadableReason(
    integrationId: IntegrationId,
    sealed: string,
  ): Promise<IntegrationTokenUnreadableReason | null> {
    const cipher = this.container.secrets
    // No cipher at all is its own reason. Reported as `no_key` rather than as a
    // key mismatch, because the fix is to configure a key and not to hunt for a
    // previous one, and because re-entering the token cannot work either.
    if (cipher === null) return 'no_key'
    const state = await cipher.inspect(sealed)
    if (state === 'readable') return null
    this.container.logger.warn(
      { integrationId, reason: state },
      'a stored integration token cannot be opened by this deployment',
    )
    return state
  }

  private noCipherMessage(): string {
    const rejected = this.container.secretsRejectedReason
    return rejected === null ? NO_KEY : `${KEY_REJECTED}: ${rejected}`
  }
}

/**
 * Whether this row is the credential in force. One entry per integration id, so
 * adding an integration to the picklist without answering the question fails the
 * build rather than shipping a row that always reports itself unused.
 */
function inUse(integrationId: IntegrationId, active: ActiveCredentials): boolean {
  const ANSWERS: Record<IntegrationId, boolean> = {
    'github-pat': active.vcs.github === 'pat',
    'gitlab-pat': active.vcs.gitlab === 'pat',
    'slack-bot-token': active.chat === 'stored',
    // A stored secret always shadows the deployment's own, so `stored` is the
    // whole answer — but only in the default org does the other source exist at
    // all, which is why this is a resolution rather than a row read.
    'slack-signing-secret': active.slackSigning === 'stored',
    'cat-factory': active.aiReview === 'stored',
  }
  return ANSWERS[integrationId]
}

/** The host a pasteable id names, or null for a credential that is not one's. */
function providerOfPat(integrationId: IntegrationId): VcsProvider | null {
  if (integrationId === vcsPatCredentialKey('github')) return 'github'
  if (integrationId === vcsPatCredentialKey('gitlab')) return 'gitlab'
  return null
}
