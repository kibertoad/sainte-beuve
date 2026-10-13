import {
  getRiskAssessmentContract,
  getRiskPolicyContract,
  listExternalRiskPoliciesContract,
  listRiskAssessmentsContract,
  requestRiskAssessmentContract,
  setRiskPolicyContract,
} from '@sainte-beuve/contracts'
import { ValidationError } from '@sainte-beuve/kernel'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { requireAdmin } from '../auth/principal.js'
import { RiskAssessmentService } from './RiskAssessmentService.js'
import { RiskPolicyService } from './RiskPolicyService.js'

const NOT_AN_ADMIN = 'Only an admin can change which pull requests are approved unattended'

/** The most board rows one listing names. */
const MAX_LISTED = 200

/**
 * The org's risk policy, and the assessments it produces. Reading a policy or
 * an assessment is any member's; changing the policy, which decides what is
 * approved with nobody looking, is an admin's.
 */
export function riskController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getRiskPolicyContract, async (c) => {
    return c.json(await new RiskPolicyService(c.get('container')).read(), 200)
  })

  buildHonoRoute(app, setRiskPolicyContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    return c.json(await new RiskPolicyService(c.get('container')).write(c.req.valid('json')), 200)
  })

  buildHonoRoute(app, listExternalRiskPoliciesContract, async (c) => {
    await requireAdmin(c, NOT_AN_ADMIN)
    return c.json(await new RiskPolicyService(c.get('container')).externalPolicies(), 200)
  })

  buildHonoRoute(app, getRiskAssessmentContract, async (c) => {
    const service = new RiskAssessmentService(c.get('container'))
    return c.json({ assessment: await service.get(c.req.valid('param').reviewId) }, 200)
  })

  buildHonoRoute(app, requestRiskAssessmentContract, async (c) => {
    const service = new RiskAssessmentService(c.get('container'))
    return c.json(await service.request(c.req.valid('param').reviewId), 202)
  })

  buildHonoRoute(app, listRiskAssessmentsContract, async (c) => {
    const ids = c.req
      .valid('query')
      .reviewIds.split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '')
    if (ids.length > MAX_LISTED) {
      throw new ValidationError(`At most ${MAX_LISTED} reviews can be listed at once`)
    }
    const service = new RiskAssessmentService(c.get('container'))
    return c.json({ assessments: await service.listByReviews(ids) }, 200)
  })

  return app
}
