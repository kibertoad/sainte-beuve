import type { LatestAiReviewRun, PullRequestRef } from '@sainte-beuve/contracts'
import { MAX_AI_REVIEW_LOOKUP } from '@sainte-beuve/contracts'
import { LATEST_RUNS_FRESH_MS } from '../utils/aiReviewLatest'

interface Known {
  runs: LatestAiReviewRun[]
  at: number
}

/**
 * The AI review runs the rows on screen offer, by pull request URL: the runs in
 * flight, so a row offers their progress rather than a second run, and the
 * latest completed one, so it offers its results.
 *
 * Batched like `usePullRequestAssessments`, but asked again once stale, since
 * a run settles while the list is open elsewhere.
 */
const queued = new Map<string, PullRequestRef>()
let flushing: Promise<void> | null = null

export function useLatestAiReviewRuns() {
  const api = useSainteBeuveApi()
  const known = useState<Record<string, Known>>('latest-ai-review-runs', () => ({}))

  async function flush(): Promise<void> {
    await nextTick()
    const batch = [...queued.values()]
    queued.clear()
    flushing = null
    for (let start = 0; start < batch.length; start += MAX_AI_REVIEW_LOOKUP) {
      const chunk = batch.slice(start, start + MAX_AI_REVIEW_LOOKUP)
      try {
        const { runs } = await api.lookUpLatestAiReviewRuns(chunk)
        const at = Date.now()
        for (const pullRequest of chunk) {
          const own = runs.filter((run) => run.pullRequest.url === pullRequest.url)
          known.value[pullRequest.url] = { runs: own, at }
        }
      } catch {
        // A lookup that failed leaves its rows unknown, so they keep the button that files.
      }
    }
  }

  /** Ask for one pull request's latest runs, unless they are freshly known or asked for. */
  function want(pullRequest: PullRequestRef): void {
    const held = known.value[pullRequest.url]
    if (held !== undefined && Date.now() - held.at < LATEST_RUNS_FRESH_MS) return
    if (queued.has(pullRequest.url)) return
    queued.set(pullRequest.url, pullRequest)
    flushing ??= flush()
  }

  /** Record a run just filed, so the row shows its progress without another lookup. */
  function remember(run: LatestAiReviewRun): void {
    const held = known.value[run.pullRequest.url]?.runs ?? []
    known.value[run.pullRequest.url] = { runs: [...held, run], at: Date.now() }
  }

  function runsOf(pullRequest: PullRequestRef): LatestAiReviewRun[] {
    return known.value[pullRequest.url]?.runs ?? []
  }

  return { want, remember, runsOf }
}
