---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/risk': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
---

Pull requests can be assessed for complexity, risk and impact, and the ones
within an org's risk policy approved with nobody looking.

- A risk policy on the org (`GET`/`PUT /api/v1/settings/risk-policy`, admin to
  change): whether pull requests are assessed, by cat-factory or from their
  changed files, held to the org's own ceilings and per-class rules or to one of
  its cat-factory risk policies, and whether one within it is approved, optionally
  only after a clean AI review. Off by default.
- `@sainte-beuve/risk`: the change classifier (cat-factory's rules), the
  heuristic scorer, policy evaluation and the approval plan, all pure.
- `VcsGateway` gains `changedFiles`, `approve` and `withdrawApproval` on GitHub
  and GitLab. `approve` and `withdrawApproval` say whether the host carried the
  text with them (`bodyPosted`, `messagePosted`); where it did not, the caller
  posts it as a comment. Approvals go out as the org's approver token for the
  host (`github-approver-token`, `gitlab-approver-token`) or the GitHub App,
  never as a person, and only in a repository the org registered.
- A GitHub `synchronize` or a GitLab update that pushed commits is the new
  `assess` intent: an automatic approval is withdrawn and the new head assessed.
- `risk_assessments`, in all three stores, with a migration per dialect.
  `RiskAssessmentRepository.replace` writes only over the `revision` it names,
  so a step claims its row and never overwrites one new commits restarted. The
  reminder clock drives assessments their own request let go of.
- `@sainte-beuve/ai-review` needs `@cat-factory/sdk` 0.58.0, the first with the
  pull-request assessment endpoint.
- `/health` and `/api/v1/capabilities` report `externalRiskAssessment`; `/health`
  reports `autoApproval` per host.
- The Configuration screen has a Risk policy page, and board rows show where
  their assessment stands.
