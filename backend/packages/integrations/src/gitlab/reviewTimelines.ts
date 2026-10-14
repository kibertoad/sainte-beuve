import type { ProjectRef } from '@sainte-beuve/contracts'
import type {
  EpochMs,
  PullRequestTimeline,
  ReviewEvent,
  ReviewTimelines,
} from '@sainte-beuve/kernel'
import { MAX_PAGES } from './client.js'
import { type GitLabHistoryRequest, gitlabGraphql } from './history.js'

/** Half the open reads' page, because every merge request carries its notes. */
const TIMELINE_PAGE_SIZE = 50

/**
 * Notes per merge request, oldest first. A merge request with more than this
 * many loses its later approvals from the read; the first review and the first
 * approval are what a report times, and they are early by nature.
 */
const NOTES_PER_MERGE_REQUEST = 100

const REVIEW_TIMELINES_QUERY = `query ReviewTimelines($fullPath: ID!, $createdAfter: Time!, $after: String) {
  project(fullPath: $fullPath) {
    mergeRequests(createdAfter: $createdAfter, sort: CREATED_DESC, first: ${TIMELINE_PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        iid
        title
        webUrl
        draft
        createdAt
        mergedAt
        closedAt
        author { username }
        notes(first: ${NOTES_PER_MERGE_REQUEST}) {
          nodes { createdAt system body author { username bot } }
        }
      }
    }
  }
}`

interface TimelineNote {
  createdAt: string
  system: boolean
  body: string
  author: { username: string; bot: boolean } | null
}

interface TimelineMergeNode {
  iid: string
  title: string
  webUrl: string
  draft: boolean
  createdAt: string
  mergedAt: string | null
  closedAt: string | null
  author: { username: string } | null
  notes: { nodes: TimelineNote[] } | null
}

interface ReviewTimelinesAnswer {
  data?: {
    project: {
      mergeRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: TimelineMergeNode[]
      }
    } | null
  } | null
  errors?: { message: string }[]
}

/**
 * The system notes GitLab writes for the events a report times. GitLab has no
 * review object and no approval timestamp on its approvals, so these are where
 * both are recorded.
 */
const APPROVED_NOTE = /^approved this merge request/i
const CHANGES_REQUESTED_NOTE = /^requested changes/i
const READY_NOTE = /^marked this merge request as \*\*ready\*\*/i

/** The project's merge requests opened since `since`, newest first, each with its review events. */
export async function gitlabReviewTimelines(
  project: ProjectRef,
  since: EpochMs,
  request: GitLabHistoryRequest,
): Promise<ReviewTimelines> {
  const merges: TimelineMergeNode[] = []
  let after: string | null = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const answer: ReviewTimelinesAnswer = await gitlabGraphql<ReviewTimelinesAnswer>(
      {
        query: REVIEW_TIMELINES_QUERY,
        variables: {
          fullPath: `${project.owner}/${project.repo}`,
          createdAfter: new Date(since).toISOString(),
          after,
        },
      },
      request,
      'review timeline',
    )
    const connection = answer.data?.project?.mergeRequests
    merges.push(...(connection?.nodes ?? []))
    const endCursor = connection?.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
    if (endCursor === null) return { pullRequests: merges.map(timelineOf), truncated: false }
    after = endCursor
  }
  // Every page was read and the window still reaches further back.
  return { pullRequests: merges.map(timelineOf), truncated: true }
}

function timelineOf(merge: TimelineMergeNode): PullRequestTimeline {
  const createdAt = Date.parse(merge.createdAt)
  const notes = merge.notes?.nodes ?? []
  const readyNote = notes.filter((note) => note.system && READY_NOTE.test(note.body)).at(-1)
  return {
    number: Number(merge.iid),
    title: merge.title,
    url: merge.webUrl,
    authorLogin: merge.author?.username ?? null,
    draft: merge.draft,
    createdAt,
    readyAt: readyNote === undefined ? createdAt : Date.parse(readyNote.createdAt),
    mergedAt: merge.mergedAt === null ? null : Date.parse(merge.mergedAt),
    closedAt: closedAtOf(merge),
    reviews: notes.flatMap(reviewEventOf),
  }
}

/** GitLab leaves `closedAt` empty on a merged merge request; merged is closed here. */
function closedAtOf(merge: TimelineMergeNode): EpochMs | null {
  const at = merge.closedAt ?? merge.mergedAt
  return at === null ? null : Date.parse(at)
}

/** A comment by anybody is a review on GitLab; an approval and a change request are system notes. */
function reviewEventOf(note: TimelineNote): ReviewEvent[] {
  if (note.author === null) return []
  const kind = kindOf(note)
  if (kind === null) return []
  return [
    {
      login: note.author.username,
      bot: note.author.bot,
      kind,
      at: Date.parse(note.createdAt),
    },
  ]
}

function kindOf(note: TimelineNote): ReviewEvent['kind'] | null {
  if (!note.system) return 'commented'
  if (APPROVED_NOTE.test(note.body)) return 'approved'
  if (CHANGES_REQUESTED_NOTE.test(note.body)) return 'changes_requested'
  return null
}
