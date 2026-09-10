import type {
  AttentionRequest,
  Connections,
  ConnectStart,
  CreateAttentionRequestInput,
  CreateProjectInput,
  IntegrationId,
  IntegrationTokenStatus,
  Project,
  PullRequestRef,
  ReviewCommitment,
  Reviewer,
  ReviewRequest,
  UpdateProject,
  VcsProvider,
  Viewer,
  Workspace,
} from '@sainte-beuve/contracts'

/**
 * The SPA's single door to the backend.
 *
 * One composable rather than `$fetch` at each call site: the base URL comes from
 * runtime config, the error envelope is unwrapped in one place, and a route added
 * to `@sainte-beuve/contracts` has exactly one place to be reached from.
 *
 * PLACEHOLDER: this calls the routes by path today. The contracts already carry
 * the method, path and response schema (`@toad-contracts/valibot`), so the next
 * slice replaces the hand-written paths with `sendByApiContract`, and a response
 * that does not match its contract becomes a client-side error instead of an
 * undefined three components later. See docs/implementation-plan.md, slice 2.
 */
export function useSainteBeuveApi() {
  const apiBase = useRuntimeConfig().public.apiBase

  async function get<T>(path: string): Promise<T> {
    return $fetch<T>(`${apiBase}/api/v1${path}`)
  }

  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return $fetch<T>(`${apiBase}/api/v1${path}`, { method: 'POST', body })
  }

  async function patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return $fetch<T>(`${apiBase}/api/v1${path}`, { method: 'PATCH', body })
  }

  async function put<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return $fetch<T>(`${apiBase}/api/v1${path}`, { method: 'PUT', body })
  }

  async function del<T>(path: string): Promise<T> {
    return $fetch<T>(`${apiBase}/api/v1${path}`, { method: 'DELETE' })
  }

  return {
    apiBase,
    /** Where an `EventSource` attaches. Not `$fetch`: the browser opens it itself. */
    attentionStreamUrl: `${apiBase}/api/v1/attention/stream`,

    getViewer: () => get<Viewer>('/me'),
    getWorkspace: () => get<Workspace>('/workspace'),

    listProjects: () => get<{ projects: Project[] }>('/projects'),
    addProject: (project: CreateProjectInput) =>
      post<Project>('/projects', project as unknown as Record<string, unknown>),
    updateProject: (projectId: string, patchBody: UpdateProject) =>
      patch<Project>(`/projects/${projectId}`, patchBody as Record<string, unknown>),
    removeProject: (projectId: string) => del<{ projects: Project[] }>(`/projects/${projectId}`),

    listAttention: () => get<{ requests: AttentionRequest[] }>('/attention'),
    requestAttention: (request: CreateAttentionRequestInput) =>
      post<AttentionRequest>('/attention', request as unknown as Record<string, unknown>),
    commitToAttention: (attentionId: string) =>
      post<AttentionRequest>(`/attention/${attentionId}/commit`, {}),
    cancelAttention: (attentionId: string) => del<AttentionRequest>(`/attention/${attentionId}`),
    commitToPullRequest: (pullRequest: PullRequestRef, title: string) =>
      post<ReviewCommitment>('/commitments', { pullRequest, title }),
    releaseCommitment: (commitmentId: string) =>
      del<{ commitments: ReviewCommitment[] }>(`/commitments/${commitmentId}`),

    listReviews: () => get<{ reviews: ReviewRequest[] }>('/reviews'),
    listReviewers: () => get<{ reviewers: Reviewer[] }>('/reviewers'),
    assignReviewers: (reviewId: string, count = 1) =>
      post<{ assigned: { reviewerId: string; displayName: string }[] }>(
        `/reviews/${reviewId}/assign`,
        { count },
      ),
    requestAiReview: (reviewId: string, instructions: string | null = null) =>
      post<{ id: string; status: string }>(`/reviews/${reviewId}/ai-review`, { instructions }),

    getIntegrationSettings: () =>
      get<{ integrations: IntegrationTokenStatus[] }>('/settings/integrations'),
    // A token goes out and never comes back: what returns is the integration's
    // state, which is all the screen renders.
    setIntegrationToken: (integrationId: IntegrationId, token: string) =>
      put<IntegrationTokenStatus>(`/settings/integrations/${integrationId}/token`, { token }),
    clearIntegrationToken: (integrationId: IntegrationId) =>
      del<IntegrationTokenStatus>(`/settings/integrations/${integrationId}/token`),
    getConnections: () => get<Connections>('/settings/connections'),
    /**
     * Where to send the browser to start a connect round trip. Fetched rather
     * than navigated to, because each call MINTS a signed state with a few
     * minutes of life: the URL has to be the one the operator clicks, not the one
     * a poll happened to produce.
     */
    startGitHubAppInstall: () => get<ConnectStart>('/settings/connections/github/app-install'),
    startSignIn: (provider: VcsProvider) =>
      get<ConnectStart>(`/settings/connections/${provider}/sign-in`),
    disconnectSignIn: (provider: VcsProvider) =>
      del<Connections>(`/settings/connections/${provider}/sign-in`),
  }
}

/**
 * The operator-facing text for a failed call. The backend answers every fault as
 * `{ error: { code, message } }` and the message names what is missing (which
 * configuration, which review), so it is the thing to show; the transport error is
 * the fallback for a backend that never answered at all.
 */
export function apiErrorMessage(err: unknown): string {
  const envelope = (err as { data?: { error?: { message?: string } } } | null)?.data?.error
  if (envelope?.message) return envelope.message
  return err instanceof Error ? err.message : 'The sainte-beuve API could not be reached'
}
