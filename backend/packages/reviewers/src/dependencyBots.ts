/**
 * The accounts Dependabot and Renovate open pull requests as. GitHub names an
 * App account `<slug>[bot]`; on GitLab and self-hosted runners the bot is a
 * plain user, usually named after the tool.
 */
const DEPENDENCY_BOT_NAMES: ReadonlySet<string> = new Set([
  'dependabot',
  'dependabot-preview',
  'renovate',
  'renovate-bot',
  'renovatebot',
])

/** Whether a pull request author is a Dependabot or Renovate account, on any host. */
export function isDependencyBot(authorLogin: string): boolean {
  const name = authorLogin
    .trim()
    .toLowerCase()
    .replace(/\[bot\]$/, '')
  return DEPENDENCY_BOT_NAMES.has(name)
}

/** Whether a host handle is a bot account: a GitHub App, or a dependency bot on any host. */
export function isBotLogin(login: string): boolean {
  return login.trim().toLowerCase().endsWith('[bot]') || isDependencyBot(login)
}
