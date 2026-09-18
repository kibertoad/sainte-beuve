// `@sainte-beuve/reviewers`: who should look at this, and why that person.
//
// Five decisions, all pure. Three are over the same candidate list: which
// reviewer the router picks (`selection`), who an attention request is addressed
// to (`attention`), and which of a host's open pull requests belong to the person
// in front of the workspace (`workspace`). They share the skill gate and the
// handle comparison on purpose, so a ping cannot reach somebody the router would
// have refused. The fourth is upstream of all of them: whether a host account
// may become a person in this org at all (`enrolment`). The fifth is downstream:
// what the BOARD is, once the router has done its work — who is on each review,
// and which of them somebody should open next (`board`).

export { buildBoard, isOverdue, isSettledReview } from './board.js'
export { decideEnrolment, type EnrolmentDecision, type EnrolmentInput } from './enrolment.js'
export {
  type AttentionAudienceRule,
  audienceRuleOf,
  isAttentionSatisfied,
  isInAttentionAudience,
  outstandingCommitments,
  selectAttentionAudience,
} from './attention.js'
export {
  diagnoseShortfall,
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
