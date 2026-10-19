import type { AiReviewInFlight, PullRequestRef } from '@sainte-beuve/contracts'
import { MAX_AI_REVIEW_LOOKUP } from '@sainte-beuve/contracts'
import { IN_FLIGHT_FRESH_MS } from '../utils/aiReviewInFlight'

interface Known {
  runs: AiReviewInFlight[]
  at: number
}

/**
 * The AI reviews in flight on the rows on screen, by pull request URL, so a row
 * offers the progress of a run already going rather than a second one.
 *
 * Batched like `usePullRequestAssessments`, but asked again once stale, since
 * a run settles while the list is open elsewhere.
 */
const queued = new Map<string, PullRequestRef>()
let flushing: Promise<void> | null = null

export function useAiReviewsInFlight() {
  const api = useSainteBeuveApi()
  const known = useState<Record<string, Known>>('ai-reviews-in-flight', () => ({}))

  async function flush(): Promise<void> {
    await nextTick()
    const batch = [...queued.values()]
    queued.clear()
    flushing = null
    for (let start = 0; start < batch.length; start += MAX_AI_REVIEW_LOOKUP) {
      const chunk = batch.slice(start, start + MAX_AI_REVIEW_LOOKUP)
      try {
        const { runs } = await api.lookUpAiReviewsInFlight(chunk)
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

  /** Ask for one pull request's runs in flight, unless they are freshly known or asked for. */
  function want(pullRequest: PullRequestRef): void {
    const held = known.value[pullRequest.url]
    if (held !== undefined && Date.now() - held.at < IN_FLIGHT_FRESH_MS) return
    if (queued.has(pullRequest.url)) return
    queued.set(pullRequest.url, pullRequest)
    flushing ??= flush()
  }

  /** Record a run just filed, so the row shows its progress without another lookup. */
  function remember(run: AiReviewInFlight): void {
    const held = known.value[run.pullRequest.url]?.runs ?? []
    known.value[run.pullRequest.url] = { runs: [...held, run], at: Date.now() }
  }

  function runsOf(pullRequest: PullRequestRef): AiReviewInFlight[] {
    return known.value[pullRequest.url]?.runs ?? []
  }

  return { want, remember, runsOf }
}
