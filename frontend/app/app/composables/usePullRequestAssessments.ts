import type { PullRequestAssessment, PullRequestRef } from '@sainte-beuve/contracts'
import { MAX_ASSESSMENT_LOOKUP } from '@sainte-beuve/contracts'

/**
 * The assessments the rows on screen show, by pull request URL: an assessment,
 * or null once looked up and found to have none.
 *
 * Every row asks for its own pull request, and the asks of one render are read
 * in a single lookup, so a list of fifty rows is one request rather than fifty.
 */
const queued = new Map<string, PullRequestRef>()
let flushing: Promise<void> | null = null

export function usePullRequestAssessments() {
  const api = useSainteBeuveApi()
  const known = useState<Record<string, PullRequestAssessment | null>>(
    'pull-request-assessments',
    () => ({}),
  )

  async function flush(): Promise<void> {
    await nextTick()
    const batch = [...queued.values()]
    queued.clear()
    flushing = null
    for (let start = 0; start < batch.length; start += MAX_ASSESSMENT_LOOKUP) {
      const chunk = batch.slice(start, start + MAX_ASSESSMENT_LOOKUP)
      try {
        const { assessments } = await api.lookUpPullRequestAssessments(chunk)
        const found = new Map(assessments.map((row) => [row.pullRequest.url, row]))
        for (const pullRequest of chunk)
          known.value[pullRequest.url] = found.get(pullRequest.url) ?? null
      } catch {
        // A lookup that failed leaves its rows unknown, so the next render asks again.
      }
    }
  }

  /** Ask for one pull request's assessment, unless it is already known or asked for. */
  function want(pullRequest: PullRequestRef): void {
    if (pullRequest.url in known.value || queued.has(pullRequest.url)) return
    queued.set(pullRequest.url, pullRequest)
    flushing ??= flush()
  }

  function remember(assessment: PullRequestAssessment): void {
    known.value[assessment.pullRequest.url] = assessment
  }

  return { known, want, remember }
}
