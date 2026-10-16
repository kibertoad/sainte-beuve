import { hostSnapshotSchemas, type PullRequestRef, snapshotDecoder } from '@sainte-beuve/contracts'
import type { AuthorTally, ProjectActivity, VcsGateway } from '@sainte-beuve/kernel'
import {
  PAST_REVIEW_READ_LIMIT,
  PAST_REVIEW_STATUSES,
  PAST_REVIEW_WINDOW_MS,
  type ReviewHistory,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { readThroughSnapshot, SNAPSHOT_MAX_AGE } from '../../integrations/hostSnapshots.js'
import { resolveVcs } from '../../integrations/resolve.js'

type Repository = Pick<PullRequestRef, 'provider' | 'owner' | 'repo'>

/** A repository's recent review history, and who opened pull requests in it. */
export interface RepositoryActivity {
  history: ReviewHistory
  authors: AuthorTally[]
}

const NO_ACTIVITY: ProjectActivity = { reviewers: [], authors: [] }

/**
 * A pull request's repository's recent review history, from the board's rows
 * and the host's own record, for `pastReviewCounts` to credit to reviewers.
 *
 * One read shared by the router and the recommendations, so the reviewer an
 * author is told fits best and the odds an automatic assignment draws with are
 * computed from the same history.
 */
export async function readReviewHistory(
  container: AppContainer,
  pullRequest: Repository,
): Promise<ReviewHistory> {
  return (await readRepositoryActivity(container, pullRequest)).history
}

/**
 * The same history, with the host's tally of who opened pull requests in the
 * window. `gateway` is the credential to ask the host with when the caller
 * already resolved one; null asks the board alone.
 */
export async function readRepositoryActivity(
  container: AppContainer,
  repository: Repository,
  gateway?: VcsGateway | null,
): Promise<RepositoryActivity> {
  const ref = { provider: repository.provider, owner: repository.owner, repo: repository.repo }
  const since = container.clock.now() - PAST_REVIEW_WINDOW_MS
  const [board, host] = await Promise.all([
    container.repositories.reviews.listForRepository(ref, {
      status: PAST_REVIEW_STATUSES,
      since,
      limit: PAST_REVIEW_READ_LIMIT,
    }),
    hostActivity(container, { ref, since, gateway }),
  ])
  return { history: { board, host: host.reviewers }, authors: host.authors }
}

const decodeActivity = snapshotDecoder(hostSnapshotSchemas.activity)

/**
 * The host's tallies, or none. Best-effort like every other host read on this
 * path: a host that is not configured, or is down, leaves the board's count to
 * stand rather than failing an assignment or a recommendation.
 */
async function hostActivity(
  container: AppContainer,
  read: { ref: Repository; since: number; gateway: VcsGateway | null | undefined },
): Promise<ProjectActivity> {
  const { ref, since } = read
  try {
    const gateway =
      read.gateway === undefined
        ? ((await resolveVcs(container, ref.provider))?.gateway ?? null)
        : read.gateway
    if (gateway === null) return NO_ACTIVITY
    // Keyed without `since`: the window is long next to how long a snapshot is kept.
    return await readThroughSnapshot(container, {
      source: ref.provider,
      key: `activity:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`,
      maxAgeMs: SNAPSHOT_MAX_AGE.activity,
      decode: decodeActivity,
      fetch: () => gateway.pastActivity(ref, since),
    })
  } catch (err) {
    container.logger.warn(
      { err, provider: ref.provider, owner: ref.owner, repo: ref.repo },
      'could not read the review history from the host',
    )
    return NO_ACTIVITY
  }
}
