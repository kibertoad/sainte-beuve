import { type CatFactoryPersonal, personalCatFactoryKey } from '@sainte-beuve/contracts'
import { UnavailableError, ValidationError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { hintOfToken } from '../../crypto/tokens.js'
import { requireCapability } from '../../http/errors.js'
import { readCatFactoryConfig } from '../../integrations/catFactoryConfig.js'
import { personalRouteRequired } from '../../integrations/catFactoryPersonal.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'

const NO_CIPHER =
  'This deployment has no encryption key, so it cannot store a cat-factory key: set SETTINGS_ENCRYPTION_KEY'
const NOT_CONFIGURED =
  'cat-factory is not configured for this org yet: an admin sets its URL and key on the Configuration screen first'
const NO_ADAPTERS = 'This deployment wired no cat-factory adapter, so a key cannot be checked'

/**
 * The caller's own cat-factory key: the one cat-factory runs their model
 * subscription through. Stored sealed beside the org's credentials, under a key
 * named after the reviewer, and only ever sent to the org's cat-factory.
 */
export class CatFactoryPersonalService {
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async read(): Promise<CatFactoryPersonal> {
    const [key, required] = await Promise.all([
      this.container.repositories.integrationTokens.get(await this.keyId()),
      personalRouteRequired(this.container),
    ])
    return {
      personalRoute: required ? 'required' : 'not_known',
      key: { stored: key !== null, hint: key?.hint ?? null },
    }
  }

  /** Checked against the org's instance before it is stored, so a typo is refused here. */
  async setKey(token: string): Promise<CatFactoryPersonal> {
    const cipher = requireCapability(this.container.secrets, NO_CIPHER)
    const config = requireCapability(await readCatFactoryConfig(this.container), NOT_CONFIGURED)
    const factory = requireCapability(this.container.gateways, NO_ADAPTERS)
    const report = await factory.catFactoryProbe({ baseUrl: config.baseUrl, apiKey: token }).probe()
    if (report.outcome === 'unauthorized') {
      throw new ValidationError(
        `cat-factory does not accept this key: ${report.detail ?? 'no detail'}`,
      )
    }
    if (report.outcome === 'unreachable') {
      throw new UnavailableError(
        `cat-factory could not be asked about this key at ${config.baseUrl}: ${report.detail ?? 'no detail'}`,
      )
    }
    const keyId = await this.keyId()
    await this.container.repositories.integrationTokens.put({
      integrationId: keyId,
      // Sealed against its own row, so it opens as this person's key and no other.
      sealed: await cipher.encrypt(token, keyId),
      hint: hintOfToken(token),
      subject: null,
      subjectIsBot: false,
      updatedAt: this.container.clock.now(),
    })
    return this.read()
  }

  async clearKey(): Promise<CatFactoryPersonal> {
    await this.container.repositories.integrationTokens.delete(await this.keyId())
    return this.read()
  }

  private async keyId(): Promise<ReturnType<typeof personalCatFactoryKey>> {
    const viewer = await new ViewerService(this.container, this.principal).current()
    return personalCatFactoryKey(viewer.reviewer.id)
  }
}
