import type {
  AiReviewResolution,
  CreateAttentionRequestInput,
  CreateProjectInput,
  CreateReviewerInput,
  IntegrationId,
  PullRequestRef,
  UpdateProject,
  UpdateReviewer,
  VcsProvider,
} from '@sainte-beuve/contracts'
import {
  addProjectContract,
  assignReviewersContract,
  cancelAttentionContract,
  clearIntegrationTokenContract,
  commitToAttentionContract,
  commitToPullRequestContract,
  createReviewerContract,
  disconnectVcsSignInContract,
  dismissAiReviewFindingContract,
  getConnectionsContract,
  getIntegrationSettingsContract,
  getViewerContract,
  getWorkspaceContract,
  listAiReviewRunsContract,
  listAttentionContract,
  listProjectsContract,
  listReviewersContract,
  listReviewsContract,
  releaseCommitmentContract,
  removeProjectContract,
  requestAiReviewContract,
  requestAttentionContract,
  resolveAiReviewContract,
  resumeAiReviewContract,
  setIntegrationTokenContract,
  startGitHubAppInstallContract,
  startVcsSignInContract,
  streamAttentionContract,
  updateProjectContract,
  updateReviewerContract,
} from '@sainte-beuve/contracts'
import type {
  ApiContract,
  ClientRequestParams,
  InferNonSseClientResponse,
  SuccessfulHttpStatusCode,
} from '@toad-contracts/core'
import {
  describeApiContract,
  mapApiContractToPath,
  SchemaValidationError,
} from '@toad-contracts/core'
import { sendByApiContract, UnexpectedResponseError } from '@toad-contracts/frontend-http-client'
import wretch from 'wretch'

// ---------------------------------------------------------------------------
// The SPA's single door to the backend, driven by the same contract objects the
// controllers are mounted from.
//
// Nothing here writes a path, a method or a response type by hand. A contract in
// `@sainte-beuve/contracts` carries all three, `buildHonoRoute` mounts the server
// half from it and `sendByApiContract` sends the client half, so a route and its
// caller cannot drift: renaming a segment or a field is a compile error here
// rather than a 404 somebody meets in the browser.
//
// The other half of that is the RESPONSE. Every body is parsed through the
// contract's schema before it reaches a component, so a backend that answers with
// a field missing fails at this boundary, naming the route and the field, instead
// of arriving three components later as an `undefined` in a template.
// ---------------------------------------------------------------------------

/** Where the versioned API is mounted. The webhook and connect paths sit outside it. */
const API_PREFIX = '/api/v1'

/** How many schema issues a contract-mismatch message names before it stops. */
const REPORTED_ISSUES = 3

const UNREACHABLE = 'The sainte-beuve API could not be reached'

/**
 * A refusal the API described, or a response it could not have described.
 *
 * `code` and `message` come from the error envelope every controller emits, and
 * the message names what is missing (which configuration, which review), so it is
 * what a screen shows. A transport failure never becomes one of these: it stays
 * the `TypeError` fetch threw, because "the backend is not running" and "the
 * backend refused" are different things for whoever is reading the toast.
 */
export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

/** What a call resolves to: the body of the contract's success response. */
type SuccessBody<TContract extends ApiContract> = Extract<
  InferNonSseClientResponse<TContract>,
  { statusCode: SuccessfulHttpStatusCode }
>['body']

/**
 * What a contract has to be called with, inferred from it: path params where it
 * declares them, a body where it declares one, and nothing where it does not.
 */
type RequestParams<TContract extends ApiContract> = ClientRequestParams<TContract, false>

/**
 * The first few field paths a schema refused, as `reviewers.0.handles: ...`.
 *
 * A Standard Schema issue addresses a field either by the key itself or by a
 * SEGMENT wrapping it, and valibot emits the second form. Stringifying the
 * segment gives `[object Object]`, which is a message naming nothing.
 */
function issueSummary(error: SchemaValidationError): string {
  return error.issues
    .slice(0, REPORTED_ISSUES)
    .map((issue) => {
      const path = issue.path
        ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
        .join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/** The `{ error: { code, message } }` envelope, read off a response the contract described. */
function fromEnvelope(contract: ApiContract, response: unknown): ApiError {
  const described = response as {
    statusCode?: number
    body?: { error?: { code?: string; message?: string; details?: unknown } }
  } | null
  const envelope = described?.body?.error
  return new ApiError(
    described?.statusCode ?? 0,
    envelope?.code ?? 'unknown',
    envelope?.message ?? `${describeApiContract(contract)} failed`,
    envelope?.details,
  )
}

/**
 * Restate a failed call as something a screen can show, naming the route.
 *
 * The three cases are three different faults. A response whose status no
 * contract entry covers is a deployment answering something this build does not
 * know about; a `SchemaValidationError` is a payload that did not match, and its
 * own message is a JSON dump of every issue, unreadable in a toast and silent
 * about where it came from. Any other `Error` passes through untouched, because
 * that is `fetch` saying the backend is not answering at all and dressing it up
 * as an API refusal would hide the one thing worth knowing. What is left is a
 * refusal the contract DID describe, which carries the API's own envelope.
 */
function toClientError(contract: ApiContract, failure: unknown): unknown {
  if (failure instanceof UnexpectedResponseError) {
    return new ApiError(
      failure.statusCode,
      'unexpected_response',
      `${describeApiContract(contract)} answered ${failure.statusCode}, which its contract does not describe`,
    )
  }
  if (failure instanceof SchemaValidationError) {
    return new ApiError(
      0,
      'contract_mismatch',
      `${describeApiContract(contract)} did not match its contract: ${issueSummary(failure)}`,
    )
  }
  return failure instanceof Error ? failure : fromEnvelope(contract, failure)
}

/**
 * Build the client for one backend.
 *
 * A function of a base URL rather than a Nuxt composable, so it can be exercised
 * by a suite with nothing else around it. `useSainteBeuveApi` is the composable
 * that reads the URL out of runtime config and calls this.
 */
export function createSainteBeuveApi(apiBase: string) {
  const client = wretch(`${apiBase}${API_PREFIX}`)

  async function call<TContract extends ApiContract>(
    contract: TContract,
    params: RequestParams<TContract>,
  ): Promise<SuccessBody<TContract>> {
    let outcome: Awaited<ReturnType<typeof sendByApiContract<TContract, false, true>>>
    try {
      outcome = await sendByApiContract<TContract, false, true>(client, contract, params)
    } catch (err) {
      throw toClientError(contract, err)
    }
    if (!outcome.result) throw toClientError(contract, outcome.error)
    // The one cast in the client, and it is the checker's limit rather than a
    // claim about the wire. `sendByApiContract` has already narrowed its result
    // to the contract's success responses; with the contract still generic here,
    // TypeScript cannot see that its narrowing and `SuccessBody` describe the
    // same set. Every method below calls this with a CONCRETE contract, which is
    // where the response type each screen sees is checked.
    return outcome.result.body as SuccessBody<TContract>
  }

  return {
    apiBase,
    /**
     * Where an `EventSource` attaches, built from the stream contract rather than
     * typed out. Not sent through `sendByApiContract`, which would give a fetch
     * stream: `EventSource` reconnects by itself, and that is the whole reason the
     * live half survives a laptop closing. The contract still owns the path.
     */
    attentionStreamUrl: `${apiBase}${API_PREFIX}${mapApiContractToPath(streamAttentionContract)}`,

    getViewer: () => call(getViewerContract, {}),
    getWorkspace: () => call(getWorkspaceContract, {}),

    listProjects: () => call(listProjectsContract, {}),
    addProject: (project: CreateProjectInput) => call(addProjectContract, { body: project }),
    updateProject: (projectId: string, patch: UpdateProject) =>
      call(updateProjectContract, { pathParams: { projectId }, body: patch }),
    removeProject: (projectId: string) =>
      call(removeProjectContract, { pathParams: { projectId } }),

    listAttention: () => call(listAttentionContract, {}),
    requestAttention: (request: CreateAttentionRequestInput) =>
      call(requestAttentionContract, { body: request }),
    commitToAttention: (attentionId: string) =>
      call(commitToAttentionContract, { pathParams: { attentionId }, body: {} }),
    cancelAttention: (attentionId: string) =>
      call(cancelAttentionContract, { pathParams: { attentionId } }),
    commitToPullRequest: (pullRequest: PullRequestRef, title: string) =>
      call(commitToPullRequestContract, { body: { pullRequest, title } }),
    releaseCommitment: (commitmentId: string) =>
      call(releaseCommitmentContract, { pathParams: { commitmentId } }),

    listReviews: () => call(listReviewsContract, {}),
    assignReviewers: (reviewId: string, count = 1) =>
      call(assignReviewersContract, { pathParams: { reviewId }, body: { count } }),

    listReviewers: () => call(listReviewersContract, {}),
    createReviewer: (reviewer: CreateReviewerInput) =>
      call(createReviewerContract, { body: reviewer }),
    updateReviewer: (reviewerId: string, patch: UpdateReviewer) =>
      call(updateReviewerContract, { pathParams: { reviewerId }, body: patch }),

    // The AI-review loop. Filing is addressed by review; everything after it by
    // the delegated RUN, the way cat-factory's own decision surface is.
    requestAiReview: (reviewId: string, instructions: string | null = null) =>
      call(requestAiReviewContract, { pathParams: { reviewId }, body: { instructions } }),
    /** Every delegated run for one review. Each in-flight one is POLLED to answer this. */
    listAiReviewRuns: (reviewId: string) =>
      call(listAiReviewRunsContract, { pathParams: { reviewId } }),
    dismissAiReviewFinding: (runId: string, findingId: string) =>
      call(dismissAiReviewFindingContract, { pathParams: { runId, findingId }, body: {} }),
    /**
     * Act on the curated selection. The answer is the run having ACCEPTED the
     * instruction: cat-factory posts asynchronously, and what landed shows up on a
     * later read as the curation's `postReport`.
     */
    resolveAiReview: (runId: string, action: AiReviewResolution, findingIds: string[]) =>
      call(resolveAiReviewContract, { pathParams: { runId }, body: { action, findingIds } }),
    resumeAiReview: (runId: string) =>
      call(resumeAiReviewContract, { pathParams: { runId }, body: {} }),

    getIntegrationSettings: () => call(getIntegrationSettingsContract, {}),
    // A token goes out and never comes back: what returns is the integration's
    // state, which is all the screen renders.
    setIntegrationToken: (integrationId: IntegrationId, token: string) =>
      call(setIntegrationTokenContract, { pathParams: { integrationId }, body: { token } }),
    clearIntegrationToken: (integrationId: IntegrationId) =>
      call(clearIntegrationTokenContract, { pathParams: { integrationId } }),

    getConnections: () => call(getConnectionsContract, {}),
    /**
     * Where to send the browser to start a connect round trip. Fetched rather
     * than navigated to, because each call MINTS a signed state with a few
     * minutes of life: the URL has to be the one the operator clicks, not the one
     * a poll happened to produce.
     */
    startGitHubAppInstall: () => call(startGitHubAppInstallContract, {}),
    startSignIn: (provider: VcsProvider) =>
      call(startVcsSignInContract, { pathParams: { provider } }),
    disconnectSignIn: (provider: VcsProvider) =>
      call(disconnectVcsSignInContract, { pathParams: { provider } }),
  }
}

export type SainteBeuveApi = ReturnType<typeof createSainteBeuveApi>

/**
 * The operator-facing text for a failed call. A refusal the API described carries
 * its own message and names what is missing, so that is the thing to show; a
 * transport failure has only whatever `fetch` said, and a rejection that is not an
 * `Error` at all gets the one sentence that is always true.
 */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return err instanceof Error ? err.message : UNREACHABLE
}
