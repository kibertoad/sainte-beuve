/**
 * Review bots and AI reviewers that post as an account the host does not flag
 * as a machine, or that a self-managed install may run under a plain user.
 * Lowercase, without the `[bot]` suffix GitHub Apps carry.
 */
export const KNOWN_AUTOMATED_REVIEWERS: ReadonlySet<string> = new Set([
  'coderabbitai',
  'copilot',
  'copilot-pull-request-reviewer',
  'github-actions',
  'gemini-code-assist',
  'sourcery-ai',
  'qodo-merge-pro',
  'qodo-merge',
  'codiumai-pr-agent',
  'codiumai-pr-agent-pro',
  'greptile-apps',
  'greptileai',
  'ellipsis-dev',
  'korbit-ai',
  'cursor',
  'bugbot',
  'graphite-app',
  'codeant-ai',
  'bito-code-review',
  'what-the-diff',
  'claude',
  'chatgpt-codex-connector',
  'sonarqubecloud',
  'sonarcloud',
  'deepsource-autofix',
  'codacy-production',
  'dependabot',
  'renovate',
])

const BOT_SUFFIX = /\[bot\]$/i

/**
 * Whether a review came from a machine: the host flags the account, the login
 * carries GitHub's `[bot]` suffix, or it is one of the review bots above.
 */
export function isAutomatedReviewer(login: string, hostBot: boolean): boolean {
  if (hostBot || BOT_SUFFIX.test(login)) return true
  return KNOWN_AUTOMATED_REVIEWERS.has(login.toLowerCase())
}
