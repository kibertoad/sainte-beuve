import type {
  AiReviewResolution,
  CreateAttentionRequestInput,
  CreateProjectInput,
  CreateReviewerInput,
  PullRequestRef,
  ReviewStatus,
  Role,
  UpdateProject,
  UpdateReviewer,
  VcsProvider,
} from '@sainte-beuve/contracts'
import {
  addProjectContract,
  assignReviewersContract,
  cancelAttentionContract,
  commitToAttentionContract,
  commitToPullRequestContract,
  createApiKeyContract,
  createReviewerContract,
  dismissAiReviewFindingContract,
  getAuthStateContract,
  getViewerContract,
  getWorkspaceContract,
  issuePath,
  listAiReviewRunsContract,
  listApiKeysContract,
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
  revokeApiKeyContract,
  signOutContract,
  startSessionSignInContract,
  streamAttentionContract,
  updateProjectContract,
  updateReviewerContract,
} from '@sainte-beuve/contracts'
import type { ApiContract } from '@toad-contracts/core'
import {
  ContractNoBody,
  describeApiContract,
  mapApiContractToPath,
  SchemaValidationError,
  validate,
} from '@toad-contracts/core'
import { sendByApiContract, UnexpectedResponseError } from '@toad-contracts/frontend-http-client'
import wretch from 'wretch'
import type { RequestParams, SuccessBody } from './contractCall'
import { configurationCalls } from './sainteBeuveSettingsApi'

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
 *
 * `code`, `statusCode` and `details` are readable wherever the call is awaited
 * directly, which is every action going through `useApiAction`. They do NOT survive
 * a trip through `useAsyncData`: Nuxt puts each rejection through h3's
 * `createError`, which builds a fresh `H3Error` for anything that is not one
 * already, so a fetch-error screen has the message and nothing else. That is why
 * `apiErrorMessage` folds the refused field names into the message rather than
 * leaving them for a component to read off `details`.
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

/** The first few field paths a schema refused, as `reviewers.0.handles: ...`. */
function issueSummary(error: SchemaValidationError): string {
  return error.issues
    .slice(0, REPORTED_ISSUES)
    .map((issue) => {
      const path = issuePath(issue)
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
 * Refuse a body the contract forbids HERE, before the request is dispatched.
 *
 * `sendByApiContract` already validates the request before it touches the network,
 * but it raises the same `SchemaValidationError` class it raises for a response that
 * broke its contract, carrying nothing that says which side failed. Mapped through
 * one code, somebody clearing a number box is told the route did not match its
 * contract, which blames the deployment for their own empty field.
 *
 * Checking the body first splits the two: anything that reaches the
 * `contract_mismatch` branch afterwards is response-side by construction, because
 * the request side has already passed the very same schema.
 */
async function checkRequest(contract: ApiContract, params: unknown): Promise<void> {
  // Both reads are off union members the generic signature hides: a contract that
  // declares no body types the field as `never`, and a params object for such a
  // contract has no `body` at all.
  const schema = (contract as { requestBodySchema?: unknown }).requestBodySchema
  const body = (params as { body?: unknown }).body
  if (body === undefined || schema === undefined || schema === ContractNoBody) return
  try {
    await validate(schema as Parameters<typeof validate>[0], body)
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw new ApiError(
        0,
        'invalid_request',
        `This request was refused before it was sent: ${issueSummary(err)}`,
      )
    }
    throw err
  }
}

/**
 * Build the client for one backend.
 *
 * A function of a base URL rather than a Nuxt composable, so it can be exercised
 * by a suite with nothing else around it. `useSainteBeuveApi` is the composable
 * that reads the URL out of runtime config and calls this.
 */
export function createSainteBeuveApi(apiBase: string) {
  // `credentials: 'include'`, because the session is an `HttpOnly` cookie and
  // the SPA is served from its own origin: without it a browser sends the
  // cookie only same-origin, so a deployment whose API is on another host would
  // sign somebody in and then render every screen as anonymous.
  //
  // It is ALL OR NOTHING, and that is worth stating where it is typed. A browser
  // refuses a response carrying `Access-Control-Allow-Origin: *` outright once a
  // request has asked to send a credential — not just the cookie, the whole
  // answer — so a cross-origin deployment that never named this SPA does not
  // degrade to anonymous reads, it fails every call. Which is why the backend
  // folds `APP_BASE_URL`'s origin into its CORS list rather than leaving a
  // hosted deployment on the wildcard it ships (see `withAppOrigin` in
  // @sainte-beuve/server).
  const client = wretch(`${apiBase}${API_PREFIX}`).options({ credentials: 'include' })

  async function call<TContract extends ApiContract>(
    contract: TContract,
    params: RequestParams<TContract>,
  ): Promise<SuccessBody<TContract>> {
    await checkRequest(contract, params)

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

    // Who is calling, and whether this deployment cares. Never refused, in
    // either mode: a screen that had to be signed in to discover that it is not
    // signed in has nowhere to start.
    getAuthState: () => call(getAuthStateContract, {}),
    signOut: () => call(signOutContract, { body: {} }),
    /**
     * Where to send the browser to sign IN, as opposed to connecting a credential.
     *
     * `org` is the only place the client names a tenancy, and only at the START
     * of the round trip: the session that comes back is bound to whatever the
     * signed state said, and every request after it reads its org from there.
     */
    startSessionSignIn: (provider: VcsProvider, org?: string) =>
      call(startSessionSignInContract, { pathParams: { provider }, queryParams: { org } }),

    listApiKeys: () => call(listApiKeysContract, {}),
    /** The answer carries the key itself, which is the only time it is readable. */
    createApiKey: (label: string, role: Role = 'member') =>
      call(createApiKeyContract, { body: { label, role } }),
    revokeApiKey: (keyId: string) => call(revokeApiKeyContract, { pathParams: { keyId } }),

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

    /**
     * The board. Unfiltered it is the ACTIVE reviews, newest first and capped,
     * which is the server's default and what every screen here wants: the
     * terminal ones are never archived, so an unfiltered read grew with
     * everything the deployment had ever tracked. A caller that wants history
     * asks for the statuses it means.
     *
     * The query object is built key by key rather than spread with
     * `undefined`s: a key that is present and undefined is serialised as an
     * EMPTY parameter (`?status=`), which the contract then refuses — an absent
     * filter has to be an absent key.
     */
    listReviews: (filter: { status?: readonly ReviewStatus[]; limit?: number } = {}) => {
      const queryParams: { status?: ReviewStatus[]; limit?: string } = {}
      // Copied rather than passed through: the contract's own type is mutable,
      // and the sets a caller has to hand (`ACTIVE_REVIEW_STATUSES`) are not.
      if (filter.status !== undefined) queryParams.status = [...filter.status]
      if (filter.limit !== undefined) queryParams.limit = String(filter.limit)
      return call(listReviewsContract, { queryParams })
    },

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

    ...configurationCalls(call),
  }
}

export type SainteBeuveApi = ReturnType<typeof createSainteBeuveApi>

/**
 * The field paths an error envelope named, where it named any.
 *
 * A 400 from the request validator puts one entry per refused field in `details`,
 * and it is the only place a screen can learn WHICH field the server would not take.
 * `details` is `unknown` on the wire, so this reads it defensively and gives up
 * quietly rather than turning a bad envelope into a second error.
 */
function refusedFields(details: unknown): string[] {
  if (!Array.isArray(details)) return []
  return details
    .map((entry) =>
      typeof entry === 'object' && entry !== null && 'path' in entry
        ? String((entry as { path: unknown }).path)
        : '',
    )
    .filter((path) => path.length > 0)
}

/**
 * The operator-facing text for a failed call. A refusal the API described carries
 * its own message and names what is missing, so that is the thing to show; a
 * transport failure has only whatever `fetch` said, and a rejection that is not an
 * `Error` at all gets the one sentence that is always true.
 */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = refusedFields(err.details)
    return fields.length === 0 ? err.message : `${err.message} (${fields.join(', ')})`
  }
  return err instanceof Error ? err.message : UNREACHABLE
}
