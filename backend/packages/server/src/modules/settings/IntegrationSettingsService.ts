import type {
  IntegrationId,
  IntegrationTokenStatus,
  IntegrationTokenUnreadableReason,
} from '@sainte-beuve/contracts'
import { integrationIdSchema } from '@sainte-beuve/contracts'
import type { StoredIntegrationToken } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'

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

/** Enough of the token to recognise it, and far too little to use it. */
const HINT_LENGTH = 4

const NO_KEY =
  'Storing an integration token needs an encryption key: set SETTINGS_ENCRYPTION_KEY on the deployment'
const KEY_REJECTED =
  'Storing an integration token needs a usable encryption key, and SETTINGS_ENCRYPTION_KEY was refused'

/**
 * Whether the deployment is REACHING an integration, which is a different fact
 * from holding a credential for it: the gateways are still built from the
 * environment at boot, so a token stored here changes nothing until slice 4
 * joins the two (docs/implementation-plan.md). One entry per integration id, so
 * adding an integration to the picklist without answering this fails the build.
 */
const IN_USE: Record<IntegrationId, (container: AppContainer) => boolean> = {
  'cat-factory': (container) => container.aiReview !== null,
}

export class IntegrationSettingsService {
  constructor(private readonly container: AppContainer) {}

  /** Every known integration, stored or not, so the screen renders from one call. */
  async list(): Promise<IntegrationTokenStatus[]> {
    const stored = await this.container.repositories.integrationTokens.list()
    const byId = new Map(stored.map((row) => [row.integrationId, row]))
    return Promise.all(
      integrationIdSchema.options.map((id) => this.statusOf(id, byId.get(id) ?? null)),
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
      hint: token.slice(-HINT_LENGTH),
      updatedAt: this.container.clock.now(),
    })
    // Readable by construction: it was sealed by the cipher that just ran.
    return {
      integrationId,
      state: 'stored',
      unreadableReason: null,
      inUse: this.inUse(integrationId),
      hint: stored.hint,
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

  private absent(integrationId: IntegrationId): IntegrationTokenStatus {
    return {
      integrationId,
      state: 'absent',
      unreadableReason: null,
      inUse: this.inUse(integrationId),
      hint: null,
      updatedAt: null,
    }
  }

  private async statusOf(
    integrationId: IntegrationId,
    row: StoredIntegrationToken | null,
  ): Promise<IntegrationTokenStatus> {
    if (row === null) return this.absent(integrationId)
    const unreadableReason = await this.unreadableReason(integrationId, row.sealed)
    return {
      integrationId,
      state: unreadableReason === null ? 'stored' : 'unreadable',
      unreadableReason,
      inUse: this.inUse(integrationId),
      hint: row.hint,
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

  private inUse(integrationId: IntegrationId): boolean {
    return IN_USE[integrationId](this.container)
  }

  private noCipherMessage(): string {
    const rejected = this.container.secretsRejectedReason
    return rejected === null ? NO_KEY : `${KEY_REJECTED}: ${rejected}`
  }
}
