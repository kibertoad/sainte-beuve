import type { ReportWindow } from '@sainte-beuve/contracts'
import { DEFAULT_ORG_ID, DEFAULT_ORG_SLUG } from '@sainte-beuve/contracts'
import type { OrgReviewReport } from '@sainte-beuve/kernel'
import { mapWithConcurrency } from '../../concurrency.js'
import { type AppContainer, withOrg } from '../../container.js'
import { ReportingService } from './ReportingService.js'

/** The window every exported gauge covers. Exported as an attribute so a dashboard can say so. */
export const EXPORTED_REPORT_WINDOW: ReportWindow = '30'

/** Orgs reported at once. Each one is already a bounded fan-out over its repositories. */
const ORG_FAN_OUT = 2

export interface MetricsExportResult {
  /** Orgs whose report went out. An org with no repository its host answered for has nothing to say. */
  exported: number
  /** Orgs whose report could not be built, logged one by one. */
  failed: number
}

/**
 * One pass of the review metrics export: every org's report over the exported
 * window, pushed in one call. Runs on its own clock rather than the reminder
 * tick's, because a report reads every linked repository's history from the
 * hosts and the reminder clock runs every few minutes.
 *
 * A deployment with no exporter configured does nothing, and one org that
 * cannot be reported leaves the others' gauges going out.
 */
export async function runReviewMetricsExport(
  container: AppContainer,
): Promise<MetricsExportResult> {
  const exporter = container.reviewMetrics
  if (exporter === null) return { exported: 0, failed: 0 }
  const reports = await mapWithConcurrency(await orgsOf(container), ORG_FAN_OUT, (org) =>
    reportFor(container, org),
  )
  const built = reports.filter(
    (entry): entry is OrgReviewReport => entry !== null && entry !== 'failed',
  )
  if (built.length > 0) await exporter.export(built)
  return { exported: built.length, failed: reports.filter((entry) => entry === 'failed').length }
}

async function reportFor(
  container: AppContainer,
  org: OrgReviewReport['org'],
): Promise<OrgReviewReport | null | 'failed'> {
  try {
    const report = await new ReportingService(withOrg(container, org.id)).report({
      days: EXPORTED_REPORT_WINDOW,
    })
    return report.repositories.length === 0 ? null : { org, report }
  } catch (err) {
    container.logger.warn({ err, org: org.id }, 'could not build the review report for export')
    return 'failed'
  }
}

/** Every org, the default one included whether or not its row was ever written. */
async function orgsOf(container: AppContainer): Promise<OrgReviewReport['org'][]> {
  const stored = await container.stores.orgs.list()
  const orgs = stored.map((org) => ({ id: org.id, slug: org.slug }))
  return orgs.some((org) => org.id === DEFAULT_ORG_ID)
    ? orgs
    : [{ id: DEFAULT_ORG_ID, slug: DEFAULT_ORG_SLUG }, ...orgs]
}
