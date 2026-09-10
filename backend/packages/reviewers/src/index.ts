// `@sainte-beuve/reviewers`: who should look at this, and why that person.
//
// Three decisions, all pure and all over the same candidate list: which reviewer
// the router picks (`selection`), who an attention request is addressed to
// (`attention`), and which of a host's open pull requests belong to the person
// in front of the workspace (`workspace`). They share the skill gate and the
// handle comparison on purpose, so a ping cannot reach somebody the router would
// have refused.

export {
  type AttentionAudienceRule,
  audienceRuleOf,
  isAttentionSatisfied,
  isInAttentionAudience,
  outstandingCommitments,
  selectAttentionAudience,
} from './attention.js'
export {
  drawWeight,
  hasAllSkills,
  isEligible,
  isSameHandle,
  normalizeSkill,
  type ScoredCandidate,
  scoreCandidates,
  type SelectionInput,
  type SelectionResult,
  selectReviewers,
} from './selection.js'
export { type PartitionedPullRequests, partitionForViewer } from './workspace.js'
