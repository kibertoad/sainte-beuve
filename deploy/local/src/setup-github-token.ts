// Writes the GitHub CLI's own token into deploy/local/.env as GITHUB_TOKEN.
//
// The token reaches the file and nothing else: it is read from `gh auth token`'s
// stdout, never printed, never put on a command line, and every other line of
// .env is kept as it was. Run `gh auth login` first.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const ENV_FILE = new URL('../.env', import.meta.url)
const ENV_EXAMPLE = new URL('../.env.example', import.meta.url)
const KEY = 'GITHUB_TOKEN'

type TokenKind = 'oauth' | 'pat' | 'unknown'

function readGhToken(): string {
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    throw new Error('`gh auth token` failed. Install the GitHub CLI and run `gh auth login` first.')
  }
}

function classify(token: string): TokenKind {
  if (token.startsWith('gho_')) return 'oauth'
  if (token.startsWith('ghp_') || token.startsWith('github_pat_')) return 'pat'
  return 'unknown'
}

function currentEnv(): string {
  if (existsSync(ENV_FILE)) return readFileSync(ENV_FILE, 'utf8')
  return existsSync(ENV_EXAMPLE) ? readFileSync(ENV_EXAMPLE, 'utf8') : ''
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(content)) return content.replace(pattern, () => line)
  const separator = content === '' || content.endsWith('\n') ? '' : '\n'
  return `${content}${separator}${line}\n`
}

function main(): void {
  const token = readGhToken()
  const kind = classify(token)
  if (kind === 'unknown') {
    throw new Error(
      '`gh auth token` returned something that is not a GitHub token. Nothing was written. See "What your token is" in deploy/local/README.md.',
    )
  }
  if (kind === 'pat') {
    console.warn(
      'gh holds a personal access token (ghp_ / github_pat_), not its own OAuth token (gho_). It works, but see "What your token is" in deploy/local/README.md.',
    )
  }
  writeFileSync(ENV_FILE, upsertEnvLine(currentEnv(), KEY, token), { mode: 0o600 })
  console.log(`${KEY} written to deploy/local/.env. Restart \`pnpm dev:local\` to pick it up.`)
}

try {
  main()
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
