import type { ChangeClass } from '@sainte-beuve/contracts'

// The same rules as cat-factory's `classifyChangedFiles` (its kernel,
// `domain/change-class.ts`), so a pull request is one class whichever of the two
// assessed it. A rule changed there is changed here.

/** Higher is riskier; a mixed diff takes the highest rank present. */
export const CHANGE_CLASS_RANK: Record<ChangeClass, number> = {
  unknown: -1,
  docs: 0,
  test: 1,
  dependency: 2,
  config: 3,
  source: 4,
  schema: 5,
}

function basenameOf(lowerPath: string): string {
  const lastSlash = lowerPath.lastIndexOf('/')
  return lastSlash === -1 ? lowerPath : lowerPath.slice(lastSlash + 1)
}

function hasSegment(lowerPath: string, names: readonly string[]): boolean {
  const segments = lowerPath.split('/')
  return names.some((name) => segments.includes(name))
}

const DEPENDENCY_BASENAMES: readonly string[] = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'requirements.txt',
  'requirements-dev.txt',
  'poetry.lock',
  'pyproject.toml',
  'pipfile',
  'pipfile.lock',
  'uv.lock',
  'gemfile',
  'gemfile.lock',
  'composer.json',
  'composer.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle.lockfile',
  'mix.lock',
]

const DOC_EXTENSIONS: readonly string[] = ['.md', '.mdx', '.markdown', '.rst', '.txt', '.adoc']

const DOC_BASENAMES: readonly string[] = [
  'readme',
  'license',
  'licence',
  'changelog',
  'contributing',
  'authors',
  'notice',
  'codeowners',
]

const CONFIG_BASENAMES: readonly string[] = [
  'dockerfile',
  'containerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.dockerignore',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  'makefile',
  'justfile',
  'procfile',
  'turbo.json',
  'knip.jsonc',
  'renovate.json',
  'wrangler.toml',
  'wrangler.jsonc',
  'pnpm-workspace.yaml',
  'lefthook.yml',
]

const CONFIG_SEGMENTS: readonly string[] = [
  '.github',
  '.gitlab',
  '.circleci',
  '.husky',
  '.vscode',
  '.idea',
  '.changeset',
  'k8s',
  'kubernetes',
  'helm',
  'terraform',
  'deploy',
  'charts',
]

const TEST_SEGMENTS: readonly string[] = [
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  '__snapshots__',
  'e2e',
  'fixtures',
  'testdata',
]

const SCHEMA_SEGMENTS: readonly string[] = ['migrations', 'migration', 'drizzle', 'alembic']

const DOC_SEGMENTS: readonly string[] = ['docs', 'doc', 'documentation']

/**
 * Executable source wherever it lives. It outranks a docs or config directory,
 * so code filed under `docs/` or `deploy/` is never approved as prose.
 */
const SOURCE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.cs',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.m',
  '.mm',
  '.swift',
  '.php',
  '.ex',
  '.exs',
  '.erl',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
]

function isSchema(lower: string): boolean {
  if (lower.endsWith('.sql') || hasSegment(lower, SCHEMA_SEGMENTS)) return true
  return /(^|\/)db\/schema(\.[a-z]+)?\.[cm]?ts$/.test(lower)
}

function isTest(lower: string): boolean {
  if (/\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(lower)) return true
  if (/_test\.(go|py|rb)$/.test(lower) || /(^|\/)test_[^/]+\.py$/.test(lower)) return true
  return hasSegment(lower, TEST_SEGMENTS)
}

function isDocs(lower: string, base: string, isSource: boolean): boolean {
  if (DOC_EXTENSIONS.some((ext) => base.endsWith(ext))) return true
  if (DOC_BASENAMES.includes(base.replace(/\.[^.]+$/, ''))) return true
  if (!isSource && hasSegment(lower, DOC_SEGMENTS)) return true
  return /(^|\/)(i18n|locales|lang|translations)\/.*\.(json|ya?ml)$/.test(lower)
}

function isConfig(lower: string, base: string, isSource: boolean): boolean {
  if (CONFIG_BASENAMES.includes(base)) return true
  if (!isSource && hasSegment(lower, CONFIG_SEGMENTS)) return true
  if (/(^|\/)(tsconfig|jsconfig)[^/]*\.json$/.test(lower)) return true
  if (/(^|\/)\.?(oxlintrc|eslintrc|prettierrc|babelrc|swcrc)[^/]*$/.test(lower)) return true
  return /\.config\.[cm]?[jt]s$/.test(lower) || /\.(tf|tfvars)$/.test(lower)
}

/** One changed path's class, most specific rule first. Never `unknown`. */
export function classifyChangedPath(path: string): Exclude<ChangeClass, 'unknown'> {
  const lower = path.replaceAll('\\', '/').toLowerCase()
  const base = basenameOf(lower)
  if (isSchema(lower)) return 'schema'
  if (isTest(lower)) return 'test'
  if (DEPENDENCY_BASENAMES.includes(base)) return 'dependency'
  const isSource = SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext))
  if (isDocs(lower, base, isSource)) return 'docs'
  if (isConfig(lower, base, isSource)) return 'config'
  return 'source'
}

export interface ChangeClassification {
  /** The riskiest class present, or `unknown` for an empty list. */
  changeClass: ChangeClass
  fileCount: number
}

/** A whole pull request's class: the highest-ranked class among its paths. */
export function classifyChangedFiles(paths: readonly string[]): ChangeClassification {
  let winner: ChangeClass = 'unknown'
  let fileCount = 0
  for (const path of paths) {
    if (path.trim() === '') continue
    fileCount += 1
    const cls = classifyChangedPath(path)
    if (CHANGE_CLASS_RANK[cls] > CHANGE_CLASS_RANK[winner]) winner = cls
  }
  return { changeClass: winner, fileCount }
}
