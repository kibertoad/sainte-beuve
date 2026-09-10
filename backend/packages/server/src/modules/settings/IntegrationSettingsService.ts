import type { IntegrationId, IntegrationTokenStatus } from '@sainte-beuve/contracts'
import { integrationIdSchema } from '@sainte-beuve/contracts'
import { getErrorMessage, type StoredIntegrationToken } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'

/**
 * The credentials a deployment attaches to its integrations, entered in the SPA
 * rather than in the environment.
 *
 * A token goes in through the cipher and never comes back out: what the screen
 * reads is a STATE per integration, and the only way to change a stored token is
 * to replace it. That is why `list` opens each envelope and throws the plaintext
 * away, rather than trusting that a row which exists is a row the deployment can
 * still use: an encryption key that was rotated leaves a token stored and
 * unusable, and an operator who is not told that sees a configured integration
 * failing for no visible reason.
 */

/** Enough of the token to recognise it, and far too little to use it. */
const HINT_LENGTH = 4

const MISSING_CIPHER =
  'Storing an integration token needs an encryption key: set SETTINGS_ENCRYPTION_KEY on the deployment'

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
    const cipher = requireCapability(this.container.secrets, MISSING_CIPHER)
    const stored = await this.container.repositories.integrationTokens.put({
      integrationId,
      sealed: await cipher.encrypt(token),
      hint: token.slice(-HINT_LENGTH),
      updatedAt: this.container.clock.now(),
    })
    // Readable by construction: it was sealed by the cipher that just ran.
    return { integrationId, state: 'stored', hint: stored.hint, updatedAt: stored.updatedAt }
  }

  /**
   * Clearing needs no cipher. A deployment whose key is gone must still be able
   * to drop the token that key sealed, or the only way out of a rotation is a
   * store surgery.
   */
  async clearToken(integrationId: IntegrationId): Promise<IntegrationTokenStatus> {
    await this.container.repositories.integrationTokens.delete(integrationId)
    return { integrationId, state: 'absent', hint: null, updatedAt: null }
  }

  private async statusOf(
    integrationId: IntegrationId,
    row: StoredIntegrationToken | null,
  ): Promise<IntegrationTokenStatus> {
    if (row === null) {
      return { integrationId, state: 'absent', hint: null, updatedAt: null }
    }
    return {
      integrationId,
      state: (await this.canOpen(integrationId, row.sealed)) ? 'stored' : 'unreadable',
      hint: row.hint,
      updatedAt: row.updatedAt,
    }
  }

  private async canOpen(integrationId: IntegrationId, sealed: string): Promise<boolean> {
    const cipher = this.container.secrets
    if (cipher === null) return false
    try {
      await cipher.decrypt(sealed)
      return true
    } catch (err) {
      this.container.logger.warn(
        { integrationId, reason: getErrorMessage(err) },
        'stored integration token could not be decrypted',
      )
      return false
    }
  }
}
