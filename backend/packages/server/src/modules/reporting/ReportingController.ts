import { getReviewReportContract } from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { ReportingService } from './ReportingService.js'

/** Reports: review timings across the org's linked repositories, or in one of them. */
export function reportingController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, getReviewReportContract, async (c) => {
    const service = new ReportingService(c.get('container'))
    return c.json(await service.report(c.req.valid('query')), 200)
  })

  return app
}
