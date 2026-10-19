import {
  type CatFactoryPersonal,
  catFactoryAppLink,
  personalCatFactoryKey,
} from '@sainte-beuve/contracts'
import { type CatFactoryProbeReport, UnavailableError, ValidationError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { hintOfToken } from '../../crypto/tokens.js'
import { requireCapability } from '../../http/errors.js'
import { readCatFactoryConfig } from '../../integrations/catFactoryConfig.js'
import { personalRouteRequired } from '../../integrations/catFactoryPersonal.js'
import { catFactoryAppUrl } from '../../integrations/catFactoryAppUrl.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { SCOPES_THAT_FILE_REVIEWS } from '../connections/catFactoryCheck.js'
import { ViewerService } from '../identity/ViewerService.js'

const NO_CIPHER =
  'This deployment has no encryption key, so it cannot store a cat-factory key: set SETTINGS_ENCRYPTION_KEY'
const NOT_CONFIGURED =
  'cat-factory is not configured for this org yet: an admin sets its URL and key on the Configuration screen first'
const NO_ADAPTERS = 'This deployment wired no cat-factory adapter, so a key cannot be checked'

/** Refuse a key the probe says cannot file and answer a review. */
function refuseUnusable(report: CatFactoryProbeReport, baseUrl: string): void {
  const detail = report.detail ?? 'no detail'
  if (report.outcome === 'unreachable') {
    throw new UnavailableError(
      `cat-factory could not be asked about this key at ${baseUrl}: ${detail}`,
    )
  }
  if (report.outcome !== 'ok') {
    throw new ValidationError(`cat-factory does not accept this key: ${detail}`)
  }
  if (report.scope !== null && !SCOPES_THAT_FILE_REVIEWS.has(report.scope)) {
    throw new ValidationError(
      `This key has the \`${report.scope}\` scope. AI reviews need \`decide\` or above: mint one with it in cat-factory`,
    )
  }
}

/**
 * cat-factory's deep link into its API tokens window, prefilled for the key a
 * review on a personal subscription needs. Nothing is minted until the person
 * confirms it there.
 */
function mintPersonalKeyUrl(appUrl: string): string {
  return catFactoryAppLink(appUrl, [
    ['newApiKey', '1'],
    ['label', 'sainte-beuve'],
    ['scope', 'decide'],
    ['runsAsSelf', '1'],
    // One key for every workspace the person is in, now and later, rather than the one it is minted from.
    ['reach', 'memberships'],
  ])
}

/**
 * The caller's own cat-factory key: the one cat-factory runs their model
 * subscription through. Stored sealed beside the org's credentials, under a key
 * named after the reviewer, and only ever sent to the org's cat-factory.
 */
export class CatFactoryPersonalService {
  /** Resolved once per request: in an open deployment it asks the source-control host. */
  private keyIdResolution: Promise<ReturnType<typeof personalCatFactoryKey>> | null = null

  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async read(): Promise<CatFactoryPersonal> {
    const [key, required, config] = await Promise.all([
      this.keyId().then((keyId) => this.container.repositories.integrationTokens.get(keyId)),
      personalRouteRequired(this.container),
      readCatFactoryConfig(this.container),
    ])
    return {
      personalRoute: required ? 'required' : 'not_known',
      key: { stored: key !== null, hint: key?.hint ?? null },
      mintKeyUrl:
        config === null ? null : mintPersonalKeyUrl(await catFactoryAppUrl(this.container, config)),
    }
  }

  /** Checked against the org's instance before it is stored, so a typo is refused here. */
  async setKey(token: string): Promise<CatFactoryPersonal> {
    const cipher = requireCapability(this.container.secrets, NO_CIPHER)
    const config = requireCapability(await readCatFactoryConfig(this.container), NOT_CONFIGURED)
    const factory = requireCapability(this.container.gateways, NO_ADAPTERS)
    const report = await factory.catFactoryProbe({ baseUrl: config.baseUrl, apiKey: token }).probe()
    refuseUnusable(report, config.baseUrl)
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

  private keyId(): Promise<ReturnType<typeof personalCatFactoryKey>> {
    this.keyIdResolution ??= new ViewerService(this.container, this.principal)
      .current()
      .then((viewer) => personalCatFactoryKey(viewer.reviewer.id))
    return this.keyIdResolution
  }
}
