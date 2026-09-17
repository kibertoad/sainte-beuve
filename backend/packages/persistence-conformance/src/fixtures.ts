import type {
  AiReviewCuration,
  AiReviewRun,
  AttentionRequest,
  LinkedIdentity,
  Project,
  PullRequestRef,
  Reminder,
  Reviewer,
  ReviewCommitment,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import type { StoredApiKey, StoredIntegrationToken, StoredSession } from '@sainte-beuve/kernel'

/**
 * The rows the suite writes.
 *
 * Full contract objects with every field set, rather than the two fields a case
 * asserts on. A store that dropped a nullable on the way through would otherwise
 * pass: the payload column carries the whole row, and the whole row is what has
 * to come back.
 */

export function pullRequest(overrides: Partial<PullRequestRef> = {}): PullRequestRef {
  return {
    provider: 'github',
    owner: 'platform',
    repo: 'api',
    number: 12,
    url: 'https://github.com/platform/api/pull/12',
    ...overrides,
  }
}

export function reviewer(id: string, overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    id,
    displayName: `Reviewer ${id}`,
    handles: { github: `${id}-gh`, gitlab: null },
    slackUserId: 'U123',
    team: 'platform',
    skills: ['typescript'],
    availability: 'available',
    weight: 1,
    outstandingReviews: 0,
    createdAt: 1_000,
    ...overrides,
  }
}

export function review(id: string, overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id,
    pullRequest: pullRequest(),
    title: `Review ${id}`,
    authorLogin: 'author',
    requiredSkills: ['typescript'],
    priority: 'normal',
    status: 'open',
    assignedReviewerIds: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    assignedAt: null,
    dueAt: null,
    ...overrides,
  }
}

export function reminder(id: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    reviewId: 'review-1',
    kind: 'pending',
    channel: 'slack_dm',
    reviewerId: 'reviewer-1',
    dueAt: 1_000,
    status: 'scheduled',
    sentAt: null,
    failureReason: null,
    createdAt: 1_000,
    ...overrides,
  }
}

export function curation(overrides: Partial<AiReviewCuration> = {}): AiReviewCuration {
  return {
    status: 'awaiting_selection',
    findings: [
      {
        findingId: 'finding-1',
        title: 'Unchecked index',
        detail: 'The loop reads past the end.',
        path: 'src/index.ts',
        line: 42,
        side: 'RIGHT',
        severity: 'high',
        category: 'correctness',
        suggestedFix: 'Guard the read.',
      },
    ],
    selectedFindingIds: [],
    postedFindingIds: [],
    postedBody: false,
    postAttempts: 0,
    postReport: null,
    sliceCount: 2,
    reportedSliceCount: 2,
    lastActivityAt: 2_000,
    resumeAttempts: 0,
    maxResumeAttempts: 3,
    ...overrides,
  }
}

export function aiReviewRun(id: string, overrides: Partial<AiReviewRun> = {}): AiReviewRun {
  return {
    id,
    reviewId: 'review-1',
    status: 'awaiting_selection',
    catFactoryTaskId: 'task-1',
    catFactoryRunId: 'run-1',
    catFactoryUrl: 'https://cat-factory.example.com/runs/run-1',
    summary: null,
    failureReason: null,
    curation: curation(),
    requestedAt: 1_000,
    completedAt: null,
    ...overrides,
  }
}

export function integrationToken(
  integrationId: string,
  overrides: Partial<StoredIntegrationToken> = {},
): StoredIntegrationToken {
  return {
    integrationId,
    sealed: 'v1.aes-256-gcm.sealed-envelope',
    hint: 'cdef',
    subject: null,
    updatedAt: 1_000,
    ...overrides,
  }
}

export function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    provider: 'github',
    owner: 'platform',
    repo: 'api',
    webUrl: 'https://github.com/platform/api',
    skills: ['Backend', 'Frontend'],
    createdAt: 1_000,
    ...overrides,
  }
}

export function identity(overrides: Partial<LinkedIdentity> = {}): LinkedIdentity {
  return { provider: 'github', subject: '4711', username: 'octocat', linkedAt: 1_000, ...overrides }
}

export function attentionRequest(
  id: string,
  overrides: Partial<AttentionRequest> = {},
): AttentionRequest {
  return {
    id,
    pullRequest: pullRequest(),
    title: `Attention ${id}`,
    requestedById: 'reviewer-1',
    requestedByName: 'Reviewer 1',
    requiredSkills: ['typescript'],
    sameTeamOnly: false,
    team: 'platform',
    neededCommitments: 1,
    commitments: [],
    note: null,
    status: 'open',
    createdAt: 1_000,
    updatedAt: 1_000,
    resolvedAt: null,
    ...overrides,
  }
}

export function commitment(
  id: string,
  overrides: Partial<ReviewCommitment> = {},
): ReviewCommitment {
  return {
    id,
    reviewerId: 'reviewer-1',
    pullRequest: pullRequest(),
    title: 'Ship the thing',
    attentionRequestId: null,
    createdAt: 1_000,
    ...overrides,
  }
}

export function session(id: string, overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id,
    tokenDigest: `digest-${id}`,
    reviewerId: 'r1',
    provider: 'github',
    subject: '4242',
    createdAt: 1_000,
    lastSeenAt: 1_000,
    expiresAt: 100_000,
    ...overrides,
  }
}

export function apiKey(id: string, overrides: Partial<StoredApiKey> = {}): StoredApiKey {
  return {
    id,
    tokenDigest: `digest-${id}`,
    label: `key ${id}`,
    hint: 'abcd',
    createdBy: 'r1',
    createdAt: 1_000,
    lastUsedAt: null,
    ...overrides,
  }
}
