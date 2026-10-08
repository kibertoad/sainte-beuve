import * as v from 'valibot'
import { vcsProviderSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Guided review: a deep dive into one pull request, run by cat-factory.
//
// cat-factory explains the change (what it does, what it touches, its risks,
// where to look first), answers questions about it in threads, and drafts
// review comments on the lines they are about. sainte-beuve relays that
// surface; it owns none of it, so every shape below is cat-factory's own
// schema, imported from `@cat-factory/contracts` rather than copied. A field
// cat-factory adds reaches this screen with a dependency bump, and one it
// renames is a compile error here instead of an `undefined` in a template.
// ---------------------------------------------------------------------------

export {
  GUIDED_REVIEW_QUESTION_MAX,
  askGuidedReviewSchema,
  guidedReviewExchangeSchema,
  guidedReviewSessionViewSchema,
  guidedReviewThreadViewSchema,
  openGuidedReviewThreadSchema,
  requestGuidedReviewDraftsSchema,
} from '@cat-factory/contracts'
export type {
  AskGuidedReviewInput,
  GuidedReviewAnchor,
  GuidedReviewCommentDraft,
  GuidedReviewExchange,
  GuidedReviewFailure,
  GuidedReviewFailureReason,
  GuidedReviewMessage,
  GuidedReviewOverview,
  GuidedReviewOverviewContent,
  GuidedReviewSession,
  GuidedReviewSessionView,
  GuidedReviewThreadSummary,
  GuidedReviewThreadView,
  OpenGuidedReviewThreadInput,
  RequestGuidedReviewDraftsInput,
} from '@cat-factory/contracts'

/**
 * The pull request a guided review is about, without its URL.
 *
 * cat-factory addresses a pull request by its coordinates, and the repository
 * has to be a registered project here as well as a linked repository there:
 * the project is what makes the review this org's to read.
 */
export const guidedReviewTargetSchema = v.object({
  provider: vcsProviderSchema,
  owner: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  repo: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
})
export type GuidedReviewTarget = v.InferOutput<typeof guidedReviewTargetSchema>

/** The same target as a query string, for the lookup that spends nothing. */
export const guidedReviewTargetQuerySchema = v.object({
  provider: vcsProviderSchema,
  owner: guidedReviewTargetSchema.entries.owner,
  repo: guidedReviewTargetSchema.entries.repo,
  number: v.pipe(
    v.string(),
    v.regex(/^\d+$/, 'Must be a whole number'),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(1),
  ),
})
