import type { ProjectRef } from '@sainte-beuve/contracts'
import type {
  EpochMs,
  PullRequestTimeline,
  ReviewEvent,
  ReviewTimelines,
} from '@sainte-beuve/kernel'
import { MAX_PAGES } from './client.js'
import { type GitHubHistoryRequest, githubGraphql } from './history.js'

/**
 * Half GitHub's page size, because every pull request carries its reviews and
 * a full page of fifty each is the size of query GitHub starts timing out on.
 */
const TIMELINE_PAGE_SIZE = 50

const REVIEWS_PER_PULL_REQUEST = 50

/**
 * Newest first by creation, so the read stops at the first page that reaches
 * past the window. PENDING reviews are left out: they are drafts only their
 * writer can see. The last ready-for-review event is when a draft asked for one.
 */
const REVIEW_TIMELINES_QUERY = `query ReviewTimelines($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: ${TIMELINE_PAGE_SIZE}, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        isDraft
        createdAt
        mergedAt
        closedAt
        author { login }
        reviews(first: ${REVIEWS_PER_PULL_REQUEST}, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
          nodes { state submittedAt author { __typename login } }
        }
        timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) {
          nodes { ... on ReadyForReviewEvent { createdAt } }
        }
      }
    }
  }
}`

interface TimelineReviewNode {
  state: string
  submittedAt: string | null
  author: { __typename: string; login: string } | null
}

interface TimelinePullNode {
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  mergedAt: string | null
  closedAt: string | null
  author: { login: string } | null
  reviews: { nodes: TimelineReviewNode[] }
  timelineItems: { nodes: { createdAt?: string }[] } | null
}

interface ReviewTimelinesAnswer {
  data?: {
    repository: {
      pullRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: TimelinePullNode[]
      }
    } | null
  } | null
  errors?: { message: string }[]
}

/** The repository's pull requests opened since `since`, newest first, each with its reviews. */
export async function githubReviewTimelines(
  project: ProjectRef,
  since: EpochMs,
  request: GitHubHistoryRequest,
): Promise<ReviewTimelines> {
  const pulls: TimelinePullNode[] = []
  let after: string | null = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const answer: ReviewTimelinesAnswer = await githubGraphql<ReviewTimelinesAnswer>(
      {
        query: REVIEW_TIMELINES_QUERY,
        variables: { owner: project.owner, name: project.repo, after },
      },
      request,
      'review timeline',
    )
    const connection = answer.data?.repository?.pullRequests
    pulls.push(...(connection?.nodes ?? []))
    const endCursor = connection?.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
    if (endCursor === null || reachesBefore(connection?.nodes ?? [], since)) {
      return { pullRequests: timelinesSince(pulls, since), truncated: false }
    }
    after = endCursor
  }
  // Every page was read and the window still reaches further back.
  return { pullRequests: timelinesSince(pulls, since), truncated: true }
}

function reachesBefore(pulls: readonly TimelinePullNode[], since: EpochMs): boolean {
  return pulls.some((pull) => Date.parse(pull.createdAt) < since)
}

function timelinesSince(pulls: readonly TimelinePullNode[], since: EpochMs): PullRequestTimeline[] {
  return pulls.filter((pull) => Date.parse(pull.createdAt) >= since).map(timelineOf)
}

function timelineOf(pull: TimelinePullNode): PullRequestTimeline {
  const createdAt = Date.parse(pull.createdAt)
  const readyEvent = pull.timelineItems?.nodes.at(-1)?.createdAt
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url,
    authorLogin: pull.author?.login ?? null,
    draft: pull.isDraft,
    createdAt,
    readyAt: readyEvent === undefined ? createdAt : Date.parse(readyEvent),
    mergedAt: pull.mergedAt === null ? null : Date.parse(pull.mergedAt),
    closedAt: pull.closedAt === null ? null : Date.parse(pull.closedAt),
    reviews: pull.reviews.nodes.flatMap(reviewEventOf),
  }
}

/** A dismissed review was an approval or a change request once; it still counts as a review. */
function reviewEventOf(review: TimelineReviewNode): ReviewEvent[] {
  if (review.author === null || review.submittedAt === null) return []
  return [
    {
      login: review.author.login,
      bot: review.author.__typename === 'Bot',
      kind: kindOf(review.state),
      at: Date.parse(review.submittedAt),
    },
  ]
}

function kindOf(state: string): ReviewEvent['kind'] {
  if (state === 'APPROVED') return 'approved'
  if (state === 'CHANGES_REQUESTED') return 'changes_requested'
  return 'commented'
}
