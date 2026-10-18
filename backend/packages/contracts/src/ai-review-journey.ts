import * as v from 'valibot'

// ---------------------------------------------------------------------------
// The parts of an AI review that say where it stands and what to do with it:
// the slices the reviewer cut the diff into, how far the step cat-factory is on
// has got, and the instruction that settles a parked review. The run and its
// curation are in `ai-review.ts`; these are split out because they are the
// review's journey rather than its record.
// ---------------------------------------------------------------------------

/**
 * One cohesive part of the diff the reviewer reviewed on its own (a refactor
 * with its call sites and tests). Findings name the slice they came from, which
 * is how the screen groups them. Known once the review has parked: cat-factory
 * records the slicing with the findings.
 */
export const aiReviewSliceSchema = v.object({
  sliceId: v.string(),
  title: v.string(),
  /** Why these files belong together, in the reviewer's words. */
  rationale: v.string(),
  paths: v.array(v.string()),
})
export type AiReviewSlice = v.InferOutput<typeof aiReviewSliceSchema>

/**
 * How far the step cat-factory is running has got, read off the run.
 *
 * `agentKind` names the worker (the reviewer, the challenge investigator, the
 * fixer) and `subtasks` is its own to-do list. While the reviewer works, that
 * list is one entry per slice, which is the only count of slices there is
 * before the review parks.
 */
export const aiReviewProgressSchema = v.object({
  agentKind: v.string(),
  /**
   * cat-factory's step state, kept open: this is stored on the run, and a state
   * a newer instance adds must not make the stored row undecodable.
   */
  state: v.string(),
  /** 0 to 1, as cat-factory reports it. */
  fraction: v.number(),
  subtasks: v.nullable(
    v.object({ completed: v.number(), inProgress: v.number(), total: v.number() }),
  ),
})
export type AiReviewProgress = v.InferOutput<typeof aiReviewProgressSchema>

/**
 * What to do with the curated selection.
 *
 * - `post` publishes the selected findings as inline pull-request comments,
 *   and hands `fixFindingIds` to the fixer once they are up.
 * - `fix` hands the selected findings to a fixer that commits onto the
 *   reviewed branch.
 * - `finish` completes the review having posted nothing, which is the exit for a
 *   run whose findings are all noise. Without it a parked review has no end.
 */
export const aiReviewResolutionSchema = v.picklist(['finish', 'fix', 'post'])
export type AiReviewResolution = v.InferOutput<typeof aiReviewResolutionSchema>

export const resolveAiReviewSchema = v.object({
  action: aiReviewResolutionSchema,
  /**
   * The findings to act on: commented on for `post`, fixed for `fix`. Required
   * non-empty for both, because both reach the real pull request and an empty
   * selection there is a caller that meant `finish`. Ignored for `finish`.
   */
  findingIds: v.optional(v.array(v.string()), []),
  /**
   * With `post` only: the findings the fixer addresses after the comments are
   * up. Comments go first because they anchor on the reviewed commit, which the
   * fixer's commits move on from. Needs a cat-factory that reports
   * `combinesPostAndFix` on the curation.
   */
  fixFindingIds: v.optional(v.array(v.string()), []),
})
export type ResolveAiReview = v.InferOutput<typeof resolveAiReviewSchema>
/** What a CALLER sends: the schema before defaults. */
export type ResolveAiReviewInput = v.InferInput<typeof resolveAiReviewSchema>
