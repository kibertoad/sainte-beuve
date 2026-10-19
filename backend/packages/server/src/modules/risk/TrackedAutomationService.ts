import type { ReviewRequest } from '@sainte-beuve/contracts'
import { planTrackedAutomation } from '@sainte-beuve/risk'
import type { AppContainer } from '../../container.js'
import { OrgService } from '../orgs/OrgService.js'
import { AiReviewService } from '../reviews/AiReviewService.js'
import { RiskAssessmentService } from './RiskAssessmentService.js'

const AUTO_AI_REVIEW_INSTRUCTIONS =
  'Filed automatically: this pull request just became ready for review, and the org reviews every one that does.'

/**
 * What the org's policy sets off when the board tracks a pull request: an
 * assessment of one it just opened a row for or that just became ready, and an
 * AI review of one that just became ready. Which of them is
 * `planTrackedAutomation`'s decision; this is the reads in front of it and the
 * calls after.
 *
 * Nothing here fails the delivery that tracked the pull request. The row has
 * landed, and a host that is answered with an error redelivers an event whose
 * tracking is already done, which for a filed AI review would be a second
 * billed job. A refusal goes to the log instead.
 */
export class TrackedAutomationService {
  constructor(private readonly container: AppContainer) {}

  async onTracked(
    review: ReviewRequest,
    event: { created: boolean; ready: boolean },
  ): Promise<void> {
    const { riskPolicy: policy } = await new OrgService(this.container).current()
    const assessment = event.created
      ? null
      : await this.container.repositories.riskAssessments.get(review.id)
    const plan = planTrackedAutomation({ policy, ...event, assessment })
    // The assessment first, so a review filed after it is one the assessment can adopt.
    if (plan.assess) {
      await this.logged(review, 'a risk assessment could not be queued', () =>
        new RiskAssessmentService(this.container).start(review, policy),
      )
    }
    if (plan.aiReview) {
      await this.logged(review, 'the automatic AI review could not be filed', () =>
        new AiReviewService(this.container).request(review.id, AUTO_AI_REVIEW_INSTRUCTIONS),
      )
    }
  }

  private async logged(
    review: ReviewRequest,
    message: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await work()
    } catch (err) {
      this.container.logger.warn({ err, reviewId: review.id }, message)
    }
  }
}
