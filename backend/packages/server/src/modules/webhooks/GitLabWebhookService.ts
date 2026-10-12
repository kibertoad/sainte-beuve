import type { PullRequestRef } from '@sainte-beuve/contracts'
import { ForbiddenError, UnavailableError } from '@sainte-beuve/kernel'
import type { GitLabEventPayload, IntakeIntent } from '@sainte-beuve/integrations'
import { interpretGitLabDelivery, verifyGitLabToken } from '@sainte-beuve/integrations'
import { isSameHandle } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveGitLabBotUsername, resolveGitLabWebhookSecret } from '../../integrations/resolve.js'
import { IGNORED, type IntakeOutcome, ReviewIntake, UNREGISTERED } from './ReviewIntake.js'

/**
 * Inbound GitLab webhook deliveries, from the token to the write.
 *
 * WHICH ORG a delivery lands in is the URL's answer and the org's own secret
 * makes it true, as it does for Slack: GitLab sends back the token its webhook
 * was configured with, and that token is this org's stored credential. The
 * container this is built with is therefore already bound (see
 * `WebhookController`).
 *
 * The project registry is checked as well. A verified delivery about a project
 * this org never registered is acked and dropped, for the reason the GitHub
 * intake drops one: a webhook can be pointed here from any project its owner
 * likes, and the token proves who configured it, not that the org took
 * responsibility for the project.
 *
 * Deliveries are not deduplicated by `X-Gitlab-Event-UUID`, any more than
 * GitHub's are by their delivery id: every intent is safe to perform twice (a
 * track or a status change lands once), and the one that is not, filing an AI
 * review, is held to one run in flight by the review's own admission rule.
 */

const NO_SECRET =
  'This deployment cannot verify GitLab deliveries: store the secret token configured on the ' +
  'GitLab webhook as the GitLab webhook secret on the GitLab configuration screen'

/**
 * The ONE refusal a delivery gets when it has not been verified, whatever
 * stopped it: on the URL that names an org, a token that does not match, an org
 * with no secret stored and a slug nobody has made must be one answer, or an
 * anonymous POST can read the tenancy list off the status code.
 */
export function unverifiedGitLabDelivery(): ForbiddenError {
  return new ForbiddenError('The GitLab delivery token did not match')
}

/** Which URL a delivery arrived on, and therefore what a refusal is allowed to say. */
export interface GitLabIntake {
  orgSlug: string
  /** Whether the caller named the org. See `SlackIntake.namedInUrl`, which this mirrors. */
  namedInUrl: boolean
}

export class GitLabWebhookService {
  constructor(
    private readonly container: AppContainer,
    private readonly intake: GitLabIntake,
  ) {}

  async handle(input: {
    rawBody: string
    token: string | null
    eventId: string | null
  }): Promise<IntakeOutcome> {
    const secret = await resolveGitLabWebhookSecret(this.container)
    if (secret === null) throw this.cannotVerify()
    if (!(await verifyGitLabToken(secret, input.token))) throw unverifiedGitLabDelivery()
    const payload = this.parse(input.rawBody, input.eventId)
    if (payload === null) return IGNORED
    const intents = interpretGitLabDelivery(payload, {
      labels: this.container.labels,
      // Read only for a comment, since it costs a credential resolution and
      // nothing else needs it.
      botUsername:
        payload.object_kind === 'note' ? await resolveGitLabBotUsername(this.container) : null,
    })
    const first = intents[0]
    if (first === undefined) return IGNORED
    if (!(await this.registered(refOf(first)))) return UNREGISTERED
    return this.performAll(intents)
  }

  /**
   * Every intent the delivery carried, in order. An update that adds the review
   * label and leaves draft at once is two intents, and the outcome names both.
   */
  private async performAll(intents: IntakeIntent[]): Promise<IntakeOutcome> {
    const intake = new ReviewIntake(this.container)
    const actions: string[] = []
    let reviewId: string | null = null
    for (const intent of intents) {
      if (intent.kind === 'command' && !(await this.answers(intent.requester))) continue
      const outcome = await intake.perform(intent)
      actions.push(outcome.action)
      reviewId = outcome.reviewId ?? reviewId
    }
    if (actions.length === 0) return IGNORED
    return { action: actions.join(','), reviewId }
  }

  /**
   * Whether a commenter is somebody the bot answers: a person this org's
   * reviewer directory knows by that GitLab handle. GitLab's note payload says
   * nothing about how its author relates to the project, and on a public
   * project anybody can comment; answering a stranger would let any account
   * spend this org's cat-factory budget with `@bot ai`. Silence rather than a
   * refusal, for the same reason the GitHub intake gives a stranger none.
   */
  private async answers(username: string): Promise<boolean> {
    const reviewers = await this.container.repositories.reviewers.list()
    return reviewers.some((reviewer) => isSameHandle(reviewer.handles.gitlab, username))
  }

  private async registered(ref: PullRequestRef): Promise<boolean> {
    const orgId = await this.container.stores.tenancy.findOrgIdForProject(ref)
    if (orgId === this.container.orgId) return true
    this.container.logger.info(
      { org: this.intake.orgSlug, owner: ref.owner, repo: ref.repo },
      'a GitLab delivery for a project this org did not register was ignored',
    )
    return false
  }

  /** Nothing to verify against. See {@link GitLabIntake.namedInUrl}. */
  private cannotVerify(): Error {
    if (!this.intake.namedInUrl) return new UnavailableError(NO_SECRET)
    this.container.logger.warn(
      { org: this.intake.orgSlug },
      'a GitLab delivery named an org with no webhook secret stored, and was refused',
    )
    return unverifiedGitLabDelivery()
  }

  private parse(rawBody: string, eventId: string | null): GitLabEventPayload | null {
    try {
      return JSON.parse(rawBody) as GitLabEventPayload
    } catch {
      // Logged rather than thrown, because answering 400 to a verified delivery
      // makes GitLab retry it and, after enough failures, disable the webhook.
      this.container.logger.warn({ eventId }, 'a verified GitLab delivery was not JSON')
      return null
    }
  }
}

function refOf(intent: IntakeIntent): PullRequestRef {
  return intent.kind === 'track' ? intent.review.pullRequest : intent.pullRequest
}
