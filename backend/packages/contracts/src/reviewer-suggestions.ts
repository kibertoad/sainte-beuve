import * as v from 'valibot'
import { attentionRequestSchema, MAX_ATTENTION_RECIPIENTS } from './attention.js'
import { reviewerRecommendationsSchema } from './recommendations.js'
import { pullRequestRefSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Suggesting reviewers for your own pull request, from My PRs: the ranked
// matches with the best few ticked, and asking the people picked to commit.
// The asking is an attention ask that names them, so they hear of it the way
// any named ask reaches them.
// ---------------------------------------------------------------------------

/**
 * How many reviewers the dialog ticks for the author, counting anybody who is
 * already on the pull request. No repository records how many approvals it
 * needs, so this is the usual two.
 */
export const SUGGESTED_REVIEWER_COUNT = 2

export const reviewerSuggestionsQuerySchema = v.object({
  pullRequest: pullRequestRefSchema,
  /** The handles the host already asks for a review, so they are shown as on it. */
  requestedReviewerLogins: v.optional(v.array(v.string()), () => []),
})
export type ReviewerSuggestionsQuery = v.InferOutput<typeof reviewerSuggestionsQuerySchema>
export type ReviewerSuggestionsQueryInput = v.InferInput<typeof reviewerSuggestionsQuerySchema>

/**
 * What somebody has already done about the pull request: `committed` to it,
 * `asked` on an open ask and not answered, `requested` on the host, or
 * `declined` an ask about it.
 */
export const suggestedReviewerStateSchema = v.picklist([
  'committed',
  'asked',
  'requested',
  'declined',
])
export type SuggestedReviewerState = v.InferOutput<typeof suggestedReviewerStateSchema>

const suggestedPersonEntries = {
  reviewerId: v.string(),
  displayName: v.string(),
  team: v.nullable(v.string()),
}

export const reviewerSuggestionsSchema = v.object({
  ...reviewerRecommendationsSchema.entries,
  /** The recommendations ticked for the author, best first. */
  preselectedIds: v.array(v.string()),
  /** Everybody else in the directory who could be asked, by name. */
  others: v.array(v.object(suggestedPersonEntries)),
  /** The people already on it, who are not offered again. */
  involved: v.array(v.object({ ...suggestedPersonEntries, state: suggestedReviewerStateSchema })),
})
export type ReviewerSuggestions = v.InferOutput<typeof reviewerSuggestionsSchema>

/**
 * Ask these people to commit to reviewing the pull request. Asking somebody
 * who was already asked, or who already committed, asks nobody twice.
 */
export const askSuggestedReviewersSchema = v.object({
  pullRequest: pullRequestRefSchema,
  title: attentionRequestSchema.entries.title,
  reviewerIds: v.pipe(
    v.array(v.string()),
    v.minLength(1, 'Pick at least one reviewer to ask'),
    v.maxLength(MAX_ATTENTION_RECIPIENTS),
  ),
  note: v.optional(v.nullable(attentionRequestSchema.entries.note), null),
})
export type AskSuggestedReviewers = v.InferOutput<typeof askSuggestedReviewersSchema>
export type AskSuggestedReviewersInput = v.InferInput<typeof askSuggestedReviewersSchema>
