import { type AiReviewRun, catFactoryRunUrl } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { readCatFactoryConfig } from '../../integrations/catFactoryConfig.js'

/**
 * Runs with their link into cat-factory built now, from the org's app URL as it
 * stands and the run id the polls have learnt, rather than the one stored when
 * the task was filed: that one predates the run id, and an app URL set since.
 */
export async function withCatFactoryLinks(
  container: AppContainer,
  runs: readonly AiReviewRun[],
): Promise<AiReviewRun[]> {
  const config = await readCatFactoryConfig(container)
  if (config === null) return [...runs]
  const appUrl = config.appUrl ?? config.baseUrl
  return runs.map((run) =>
    run.catFactoryTaskId === null
      ? run
      : {
          ...run,
          catFactoryUrl: catFactoryRunUrl(appUrl, {
            workspaceId: run.catFactoryWorkspaceId,
            taskId: run.catFactoryTaskId,
            runId: run.catFactoryRunId,
          }),
        },
  )
}

export async function withCatFactoryLink(
  container: AppContainer,
  run: AiReviewRun,
): Promise<AiReviewRun> {
  const [linked] = await withCatFactoryLinks(container, [run])
  return linked ?? run
}
