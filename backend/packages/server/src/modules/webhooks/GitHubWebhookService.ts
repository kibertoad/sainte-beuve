import { ForbiddenError } from '@sainte-beuve/kernel'
import type { GitHubDelivery, IntakeIntent } from '@sainte-beuve/integrations'
import { interpretGitHubDelivery, verifyGitHubSignature } from '@sainte-beuve/integrations'
import { type AppContainer, withOrg } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { IGNORED, type IntakeOutcome, ReviewIntake, UNREGISTERED } from './ReviewIntake.js'

/**
 * Inbound GitHub deliveries, from the signature to the write.
 *
 * The order is the security property: the signature is checked over the RAW
 * bytes before anything is parsed, because that is what GitHub signed, and
 * because a payload that has been through `JSON.parse` has already been trusted.
 *
 * WHICH ORG a delivery lands in comes from the PROJECT REGISTRY, because a
 * delivery carries no credential of ours and therefore nothing that could place
 * it: registering a repository is a tenancy claiming responsibility for it, and
 * that claim is exactly what an intake needs. A repository NOBODY registered is
 * ignored, the default org included: a GitHub App can be installed by anybody
 * who can find it, and falling back to the default org would hand whoever
 * installed it on their own repository that org's reviewers, its installation
 * tokens and its cat-factory budget. A single-tenant deployment registers its
 * repositories on the Repositories screen, which is the same act a second tenancy
 * already had to perform.
 *
 * What the delivery asks for is performed by `ReviewIntake`, which the GitLab
 * intake shares.
 */

const NO_SECRET =
  'This deployment cannot verify GitHub deliveries: set GITHUB_WEBHOOK_SECRET to the secret ' +
  'configured on the GitHub App or repository webhook'

export class GitHubWebhookService {
  constructor(private readonly container: AppContainer) {}

  async handle(input: {
    event: string
    rawBody: string
    signature: string | null
  }): Promise<IntakeOutcome> {
    const secret = requireCapability(this.container.github.webhookSecret, NO_SECRET)
    if (!(await verifyGitHubSignature(secret, input.rawBody, input.signature))) {
      // Forbidden rather than unauthorized: nothing about this request is going to
      // be retried with better credentials, and the body is a stranger's.
      throw new ForbiddenError('The GitHub delivery signature did not match')
    }
    const delivery = this.parse(input.event, input.rawBody)
    if (delivery === null) return IGNORED
    const intent = interpretGitHubDelivery(delivery, {
      labels: this.container.labels,
      botLogin: this.container.github.botLogin,
    })
    if (intent === null) return IGNORED
    // Re-entered against the org the registry placed this delivery in, rather
    // than threading a container through the intake: everything under it reads
    // the container it was built with, so binding it once here is the whole of
    // it and there is no call site that can use the wrong one.
    const placed = await this.containerFor(intent)
    if (placed === null) return UNREGISTERED
    return new ReviewIntake(placed).perform(intent)
  }

  /**
   * The org that registered the repository this delivery is about, or null when
   * none did. See above: null is acked and dropped, never defaulted.
   */
  private async containerFor(intent: IntakeIntent): Promise<AppContainer | null> {
    const ref = intent.kind === 'track' ? intent.review.pullRequest : intent.pullRequest
    const orgId = await this.container.stores.tenancy.findOrgIdForProject(ref)
    if (orgId === null) {
      // Info rather than warn: an App installed on more repositories than an org
      // registered sends these all day, and that is the installation's business.
      this.container.logger.info(
        { owner: ref.owner, repo: ref.repo, intent: intent.kind },
        'a GitHub delivery for a repository no org registered was ignored',
      )
      return null
    }
    return withOrg(this.container, orgId)
  }

  private parse(event: string, rawBody: string): GitHubDelivery | null {
    try {
      return { event, payload: JSON.parse(rawBody) as GitHubDelivery['payload'] }
    } catch {
      // A body that passed the signature check and is not JSON cannot happen
      // through GitHub. Logged rather than thrown, because answering 400 to a
      // verified delivery makes GitHub retry it forever.
      this.container.logger.warn({ event }, 'a verified GitHub delivery was not JSON')
      return null
    }
  }
}
