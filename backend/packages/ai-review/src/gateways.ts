import type { GatewayFactory } from '@sainte-beuve/kernel'
import { CatFactoryAiReviewGateway } from './CatFactoryAiReviewGateway.js'
import { CatFactoryDirectoryGateway } from './CatFactoryDirectoryGateway.js'
import { CatFactoryGuidedReviewGateway } from './CatFactoryGuidedReviewGateway.js'
import { CatFactoryProbeGateway } from './CatFactoryProbeGateway.js'
import { CatFactoryRiskAssessmentGateway } from './CatFactoryRiskAssessmentGateway.js'

/** The cat-factory members of a gateway factory, built from an org's stored connection. */
export function catFactoryGateways(): Pick<
  GatewayFactory,
  'aiReview' | 'guidedReview' | 'catFactoryProbe' | 'catFactoryDirectory' | 'riskAssessment'
> {
  return {
    aiReview: ({ pipelineId, ...target }) =>
      new CatFactoryAiReviewGateway({ ...target, pipelineId: pipelineId ?? undefined }),
    guidedReview: (access) => new CatFactoryGuidedReviewGateway(access),
    catFactoryProbe: (access) => new CatFactoryProbeGateway(access),
    catFactoryDirectory: (access) => new CatFactoryDirectoryGateway(access),
    riskAssessment: (access) => new CatFactoryRiskAssessmentGateway(access),
  }
}
