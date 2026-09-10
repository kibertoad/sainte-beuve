import * as v from 'valibot'

// ---------------------------------------------------------------------------
// AI-review wire contracts.
//
// sainte-beuve does not run the review itself: it hands the pull request to a
// cat-factory instance over the published `@cat-factory/sdk` and tracks the run.
// The instance is per deployment (a developer's own local cat-factory, or the
// org's centralized one), so nothing here assumes a URL.
//
// A delegated review is a LOOP rather than a fire-and-forget call: the reviewer
// parks with its findings, somebody says which of them are worth a comment, and
// only then does anything reach the pull request. The curation half of these
// contracts is that middle step.
// ---------------------------------------------------------------------------

/**
 * Lifecycle of one delegated review, mirroring what cat-factory reports back.
 * `requested` is the local-only state between our write and cat-factory
 * acknowledging the task, so a failure to reach it is distinguishable from a run
 * that started and then failed.
 *
 * `awaiting_selection` is the state the loop exists for: the reviewer has parked
 * with findings and nothing happens until somebody curates them. It is a state of
 * its own rather than a flavour of `running` because the two need opposite things
 * from a screen, and a board that showed them alike would leave a review waiting
 * on a person looking like a review waiting on a model.
 */
export const aiReviewStatusSchema = v.picklist([
  'requested',
  'running',
  'awaiting_selection',
  'completed',
  'failed',
  'cancelled',
])
export type AiReviewStatus = v.InferOutput<typeof aiReviewStatusSchema>

/** How bad the reviewer thinks one finding is. cat-factory's own ladder. */
export const aiReviewSeveritySchema = v.picklist(['blocker', 'high', 'medium', 'low', 'nit'])
export type AiReviewSeverity = v.InferOutput<typeof aiReviewSeveritySchema>

/** What kind of problem a finding is about. cat-factory's own vocabulary. */
export const aiReviewCategorySchema = v.picklist([
  'correctness',
  'security',
  'performance',
  'maintainability',
  'style',
  'test',
  'other',
])
export type AiReviewCategory = v.InferOutput<typeof aiReviewCategorySchema>

/**
 * One thing the reviewer found, as the curation screen shows it and as the
 * inline comment would read.
 *
 * `path` and `line` are where the comment would land. `line` is nullable and that
 * is not a defect: a finding about a file rather than a line has none, and one
 * whose line is outside the diff cannot be commented on inline, so cat-factory
 * folds it into the summary comment instead (see `folded` on the post report).
 */
export const aiReviewFindingSchema = v.object({
  /** cat-factory's stable id for the finding. What every curation verb addresses. */
  findingId: v.string(),
  title: v.string(),
  detail: v.string(),
  path: v.string(),
  line: v.nullable(v.number()),
  /** Which side of the diff the line is on, when the finding names one. */
  side: v.nullable(v.picklist(['LEFT', 'RIGHT'])),
  severity: aiReviewSeveritySchema,
  category: aiReviewCategorySchema,
  suggestedFix: v.nullable(v.string()),
})
export type AiReviewFinding = v.InferOutput<typeof aiReviewFindingSchema>

/** One finding that did not reach the pull request, and why it did not. */
export const aiReviewPostFailureSchema = v.object({
  findingId: v.string(),
  path: v.string(),
  line: v.nullable(v.number()),
  reason: v.string(),
})
export type AiReviewPostFailure = v.InferOutput<typeof aiReviewPostFailureSchema>

/**
 * What one attempt at posting actually landed.
 *
 * This is the field that makes a headless caller of the loop correct rather than
 * optimistic. A post that fails re-parks the review at `awaiting_selection` with
 * the selection cleared, which is byte-for-byte a review nobody has curated yet,
 * so without a receipt a caller that posted seven comments and landed none reads
 * back the state it held a moment earlier and reports success.
 */
export const aiReviewPostReportSchema = v.object({
  /**
   * Which pass this report describes, against `postAttempts` on the curation. A
   * retry that fails identically writes a byte-identical report, so the pair is
   * the only way to tell "my retry ran and failed the same way" from "my retry
   * has not started". Null on an instance that does not stamp it.
   */
  attempt: v.nullable(v.number()),
  /** How many findings the pass tried to comment on. */
  attempted: v.number(),
  /** How many landed as inline comments. */
  posted: v.number(),
  /**
   * How many were moved into the summary comment because their line is outside
   * the diff. Counted apart from `posted` and NOT a failure: a folded finding
   * did reach the pull request, just not on a line.
   */
  folded: v.number(),
  /** Whether the summary comment landed. Null when the pass posted no summary at all. */
  bodyPosted: v.nullable(v.boolean()),
  bodyError: v.nullable(v.string()),
  failures: v.array(aiReviewPostFailureSchema),
})
export type AiReviewPostReport = v.InferOutput<typeof aiReviewPostReportSchema>

/** Where the parked review itself is, which is finer than the run's own status. */
export const aiReviewCurationStatusSchema = v.picklist([
  'reviewing',
  'awaiting_selection',
  'challenging',
  'fixing',
  'posting',
  'done',
  'skipped',
])
export type AiReviewCurationStatus = v.InferOutput<typeof aiReviewCurationStatusSchema>

/**
 * The parked review as cat-factory currently reports it: what was found, what
 * has already been acted on, and what a caller needs to decide whether to wait.
 *
 * Null on a run carrying no review to curate, which includes a settled one: the
 * decision leaves cat-factory's list with the loop it belongs to, and the receipt
 * for a pass that settled is the run's own verdict text (`summary` on the run).
 */
export const aiReviewCurationSchema = v.object({
  status: aiReviewCurationStatusSchema,
  findings: v.array(aiReviewFindingSchema),
  /** The selection a resolution recorded. Empty while nobody has curated. */
  selectedFindingIds: v.array(v.string()),
  /** What a retry SKIPS, so re-posting the same selection never double-comments. */
  postedFindingIds: v.array(v.string()),
  /**
   * Whether the summary comment has already landed on some pass. What
   * disambiguates a null `bodyPosted`: suppressed because it is already up,
   * rather than never attempted.
   */
  postedBody: v.boolean(),
  /** How many passes at posting have run. The number `postReport.attempt` names. */
  postAttempts: v.number(),
  postReport: v.nullable(aiReviewPostReportSchema),
  /**
   * How many slices the reviewer fanned the diff out across, and how many have
   * reported. Equal means every slice is in and the reviewer is on its final
   * aggregation turn, which is the turn that can wedge with all the work done.
   *
   * Neither number is a staleness verdict and neither is `lastActivityAt`: the
   * heartbeat freezes on a long silent turn, so nothing here can tell a wedged
   * reviewer from a quiet one. They are what a person decides on.
   */
  sliceCount: v.number(),
  reportedSliceCount: v.number(),
  lastActivityAt: v.nullable(v.number()),
  /** How many resumes this review has spent, and the ceiling cat-factory enforces. */
  resumeAttempts: v.number(),
  maxResumeAttempts: v.number(),
})
export type AiReviewCuration = v.InferOutput<typeof aiReviewCurationSchema>

export const aiReviewRunSchema = v.object({
  id: v.string(),
  reviewId: v.string(),
  status: aiReviewStatusSchema,
  /** The cat-factory task this run delegated to. Null until the call is acknowledged. */
  catFactoryTaskId: v.nullable(v.string()),
  /**
   * The cat-factory RUN the task is executing, which every curation route is
   * addressed by. Null until a poll has seen one: a task is accepted before its
   * run exists, so the two ids do not arrive together.
   */
  catFactoryRunId: v.nullable(v.string()),
  /** Deep link into the cat-factory instance that ran it. */
  catFactoryUrl: v.nullable(v.string()),
  /** Short verdict text once the run completes. The full output lives in cat-factory. */
  summary: v.nullable(v.string()),
  failureReason: v.nullable(v.string()),
  /** What there is to curate right now. See {@link aiReviewCurationSchema}. */
  curation: v.nullable(aiReviewCurationSchema),
  requestedAt: v.number(),
  completedAt: v.nullable(v.number()),
})
export type AiReviewRun = v.InferOutput<typeof aiReviewRunSchema>

export const requestAiReviewSchema = v.object({
  /**
   * Extra direction for the run, e.g. 'focus on the migration'. Optional: the
   * pull request and the review request's required skills are already the brief.
   */
  instructions: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000))), null),
})
export type RequestAiReview = v.InferOutput<typeof requestAiReviewSchema>

/**
 * What to do with the curated selection.
 *
 * - `post` publishes the selected findings as inline pull-request comments.
 * - `fix` hands them to a fixer that commits onto the reviewed branch.
 * - `finish` completes the review having posted nothing, which is the exit for a
 *   run whose findings are all noise. Without it a parked review has no end.
 */
export const aiReviewResolutionSchema = v.picklist(['finish', 'fix', 'post'])
export type AiReviewResolution = v.InferOutput<typeof aiReviewResolutionSchema>

export const resolveAiReviewSchema = v.object({
  action: aiReviewResolutionSchema,
  /**
   * The findings to act on. Required non-empty for `post` and `fix`, because both
   * reach the real pull request and an empty selection there is a caller that
   * meant `finish`. Ignored for `finish`.
   */
  findingIds: v.optional(v.array(v.string()), []),
})
export type ResolveAiReview = v.InferOutput<typeof resolveAiReviewSchema>
