import * as v from 'valibot'

// ---------------------------------------------------------------------------
// The source-control vocabulary, shared by everything that touches a repository.
//
// It lives in its own file rather than beside the review board because it is the
// seam that keeps the rest of the tree provider-neutral: a project, a pull
// request, an identity and a workspace list are all addressed the same way
// whether the host is GitHub or GitLab, and the only code allowed to know the
// difference is the adapter behind `VcsGateway`.
// ---------------------------------------------------------------------------

/**
 * The hosts an adapter exists for. GitLab calls the same object a merge request
 * and the same container a project; the wire uses one set of names, and each
 * adapter translates at its own edge, because two vocabularies in the domain
 * would mean every screen and every service carrying a branch.
 */
export const vcsProviderSchema = v.picklist(['github', 'gitlab'])
export type VcsProvider = v.InferOutput<typeof vcsProviderSchema>

/** Every provider, for a screen that offers the choice and a service that sweeps them. */
export const VCS_PROVIDERS: readonly VcsProvider[] = ['github', 'gitlab'] as const

/**
 * Whether a string names a host this build knows. For the places a provider
 * arrives as text somebody else wrote: a query parameter on a callback, a row
 * from a store written by a newer build.
 */
export function isVcsProvider(value: string): value is VcsProvider {
  return (VCS_PROVIDERS as readonly string[]).includes(value)
}

/**
 * What each host calls itself. The slug is a wire value and the name is what
 * goes in a sentence: "Connected to github" reads like a bug report.
 */
const VCS_DISPLAY_NAMES: Record<VcsProvider, string> = { github: 'GitHub', gitlab: 'GitLab' }

export function vcsDisplayName(provider: VcsProvider): string {
  return VCS_DISPLAY_NAMES[provider]
}

/**
 * One segment of a repository path, as both hosts spell one.
 *
 * The alphabet is the hosts’ own: letters, digits, and `.`, `-`, `_`. What it
 * EXCLUDES is the point. These two strings are interpolated into an API path,
 * and `fetch` resolves `..` and truncates at `?` before the request leaves the
 * process, so a repo named `x/../../../repos/victim/other/issues/1/comments?`
 * would let whoever typed it choose the path the deployment’s own credential is
 * spent on. A segment is encoded again at the adapter (see `repoPath` in
 * @sainte-beuve/integrations); this is the half that refuses the value outright,
 * so nothing downstream has to be the only thing standing in the way.
 *
 * `.` and `..` are refused by name rather than by the alphabet, because a repo
 * may legitimately begin with a dot (`.github`).
 */
const SEGMENT_ALPHABET = /^[A-Za-z0-9._-]+$/

function isPathSegment(value: string): boolean {
  return SEGMENT_ALPHABET.test(value) && value !== '.' && value !== '..'
}

const SEGMENT_MESSAGE =
  'A repository name is letters, digits, dots, dashes and underscores, and is not "." or ".."'

const OWNER_MESSAGE =
  'An owner is a host login or a nested GitLab namespace: path segments of letters, digits, ' +
  'dots, dashes and underscores, none of them "." or ".."'

/**
 * A GitHub org or user, or a GitLab namespace, which may itself be nested
 * (`platform/backend`). The nesting is why this is not `repoSegmentSchema`: a
 * slash is a legitimate character HERE and nowhere else in a ref.
 */
export const repoOwnerSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1),
  v.maxLength(200),
  v.check((value: string) => value.split('/').every(isPathSegment), OWNER_MESSAGE),
)

/** The last path segment either way, and never a nested one. */
export const repoNameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1),
  v.maxLength(200),
  v.check(isPathSegment, SEGMENT_MESSAGE),
)

/**
 * A repository, addressed by the two segments both hosts agree on.
 *
 * `${owner}/${repo}` is the full path a GitLab API call URL-encodes and the
 * `owner/repo` GitHub puts in its own paths.
 */
export const projectRefSchema = v.object({
  provider: vcsProviderSchema,
  owner: repoOwnerSchema,
  repo: repoNameSchema,
})
export type ProjectRef = v.InferOutput<typeof projectRefSchema>

/** The pull request (merge request) a review or an attention request points at. */
export const pullRequestRefSchema = v.object({
  provider: vcsProviderSchema,
  /** Repository owner: a GitHub org or user, or a GitLab namespace. */
  owner: repoOwnerSchema,
  repo: repoNameSchema,
  /** The number the host shows on the page: a PR number, or a merge request `iid`. */
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
  url: v.pipe(v.string(), v.url()),
})
export type PullRequestRef = v.InferOutput<typeof pullRequestRefSchema>

/**
 * One open pull request, as a provider lists it.
 *
 * It carries the author AND the requested reviewers rather than being fetched
 * once per role, because both hosts return the two on the same list call: asking
 * twice would double the rate-limit cost of a workspace read to answer a
 * question the first answer already contains. Which list a pull request lands in
 * is then a pure decision (`partitionForViewer` in @sainte-beuve/reviewers).
 */
export const openPullRequestSchema = v.object({
  pullRequest: pullRequestRefSchema,
  title: v.string(),
  /** The author's handle on the host. */
  authorLogin: v.string(),
  /** Handles the host has formally been asked to get a review from. */
  requestedReviewerLogins: v.array(v.string()),
  /** A draft is listed but never chased: it is not asking for a review yet. */
  draft: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
export type OpenPullRequest = v.InferOutput<typeof openPullRequestSchema>

/**
 * A person's handle on each host.
 *
 * A map rather than one `githubLogin`, because the same engineer is
 * `kibertoad` on one host and `igor.savin` on another, and every place that
 * mirrors an assignment or matches an author has to ask for the handle
 * belonging to the pull request's OWN host. One field would silently address
 * the wrong person the day a second host is registered.
 *
 * Display and addressing only. What an identity is keyed on is the host's
 * stable subject (see `identity.ts`), because a handle is renameable.
 */
export const vcsHandlesSchema = v.object({
  github: v.optional(v.nullable(v.string()), null),
  gitlab: v.optional(v.nullable(v.string()), null),
})
export type VcsHandles = v.InferOutput<typeof vcsHandlesSchema>
/** What a CALLER sends: both members optional, so naming one is enough. */
export type VcsHandlesInput = v.InferInput<typeof vcsHandlesSchema>

/**
 * Somebody with no host account recorded yet.
 *
 * FROZEN, because it is a shared constant and every caller reaches it by
 * reference: one `reviewer.handles.github = x` on a row that was defaulted from
 * here would otherwise rewrite the handles of everybody who has been defaulted
 * from it since. Build a new map with {@link withHandle} instead.
 */
export const NO_VCS_HANDLES: VcsHandles = Object.freeze({ github: null, gitlab: null })

/** The handle to address this person by on one host, or null when there is none. */
export function handleOf(handles: VcsHandles, provider: VcsProvider): string | null {
  return handles[provider]
}

/** Every handle the person is known by, for a match that spans hosts. */
export function knownHandles(handles: VcsHandles): string[] {
  return VCS_PROVIDERS.map((provider) => handles[provider]).filter(
    (handle): handle is string => handle !== null,
  )
}

/** The same handles with one host's updated, for a link that learned a new name. */
export function withHandle(
  handles: VcsHandles,
  provider: VcsProvider,
  handle: string | null,
): VcsHandles {
  return { ...handles, [provider]: handle }
}

/** `owner/repo#number`: the form used in headings, log lines and chat messages. */
export function formatPullRequestRef(pr: PullRequestRef): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`
}
