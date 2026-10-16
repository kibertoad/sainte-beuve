import {
  assessPullRequestContract,
  lookUpPullRequestAssessmentsContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { PullRequestAssessmentService } from './PullRequestAssessmentService.js'

/** Scoring a pull request with cat-factory's assessor, and reading the scores back for a list. */
export function pullRequestAssessmentController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, assessPullRequestContract, async (c) => {
    const service = new PullRequestAssessmentService(c.get('container'))
    return c.json(await service.assess(c.req.valid('json').pullRequest), 200)
  })

  buildHonoRoute(app, lookUpPullRequestAssessmentsContract, async (c) => {
    const service = new PullRequestAssessmentService(c.get('container'))
    return c.json({ assessments: await service.lookUp(c.req.valid('json').pullRequests) }, 200)
  })

  return app
}
