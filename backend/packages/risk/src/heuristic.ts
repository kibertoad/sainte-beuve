import type { ChangeClass, RiskScores } from '@sainte-beuve/contracts'
import type { ChangedFile } from '@sainte-beuve/kernel'
import { classifyChangedFiles, classifyChangedPath } from './classify.js'

// A deterministic reading of a pull request from its changed files, for an org
// with no model to ask. It is deliberately conservative: it can say a small
// documentation change is harmless, and it says little more than "this is big"
// or "this touches something sensitive" about code. A policy that approves
// source changes unattended wants cat-factory as its assessor.

/** Lines in a class that weigh less than code: prose and tests move nothing at runtime. */
const LIGHT_CLASSES: ReadonlySet<ChangeClass> = new Set(['docs', 'test'])

/** Generated files whose size says nothing about the change. */
const GENERATED =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|cargo\.lock|go\.sum|poetry\.lock|uv\.lock|gemfile\.lock|composer\.lock)$|\.snap$|(^|\/)snapshot\.json$/

/** How risky a class is before anything about its size or its paths is counted. */
const BASE_RISK: Record<ChangeClass, number> = {
  docs: 0.02,
  test: 0.08,
  dependency: 0.35,
  config: 0.35,
  source: 0.3,
  schema: 0.7,
  unknown: 1,
}

interface Signal {
  pattern: RegExp
  weight: number
  label: string
}

/** Paths whose breakage costs more than their size suggests. */
const SENSITIVE: readonly Signal[] = [
  {
    pattern:
      /(^|\/|[-_.])(auth|authn|authz|oauth|session|security|crypto|secret|permission|acl|rbac)/,
    weight: 0.25,
    label: 'touches authentication or security code',
  },
  {
    pattern: /(^|\/|[-_.])(payment|billing|invoice|checkout|charge)/,
    weight: 0.2,
    label: 'touches payment or billing code',
  },
  {
    pattern: /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.ya?ml$/,
    weight: 0.15,
    label: 'changes CI workflows',
  },
]

/** Paths other code or other teams depend on. */
const SURFACES: readonly Signal[] = [
  {
    pattern: /(^|\/)(contracts?|api|openapi|proto|graphql|schema)(\/|\.|$)/,
    weight: 0.2,
    label: 'changes a public interface',
  },
  {
    pattern: /(^|\/)(deploy|terraform|k8s|kubernetes|helm|charts|infra)\//,
    weight: 0.2,
    label: 'changes deployment or infrastructure',
  },
]

/** `x / (x + half)`: 0 at nothing, 0.5 at `half`, approaching 1 without reaching it. */
function saturate(value: number, half: number): number {
  return value <= 0 ? 0 : value / (value + half)
}

function clamp(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

interface Footprint {
  /** Changed lines, with prose and tests weighed at a quarter and generated files left out. */
  weightedLines: number
  /** Files that are not prose, tests or generated. */
  codeFiles: number
  /** Distinct top-level areas (the first two path segments). */
  areas: number
  removedFiles: number
  touchesTests: boolean
}

function footprintOf(files: readonly ChangedFile[]): Footprint {
  const areas = new Set<string>()
  const footprint = { weightedLines: 0, codeFiles: 0, removedFiles: 0, touchesTests: false }
  for (const file of files) {
    const lower = file.path.replaceAll('\\', '/').toLowerCase()
    areas.add(lower.split('/').slice(0, 2).join('/'))
    if (file.status === 'removed') footprint.removedFiles += 1
    const cls = classifyChangedPath(lower)
    if (cls === 'test') footprint.touchesTests = true
    if (GENERATED.test(lower)) continue
    const lines = file.additions + file.deletions
    const light = LIGHT_CLASSES.has(cls)
    footprint.weightedLines += light ? lines / 4 : lines
    if (!light) footprint.codeFiles += 1
  }
  return { ...footprint, areas: areas.size }
}

function matched(files: readonly ChangedFile[], signals: readonly Signal[]): Signal[] {
  return signals.filter((signal) =>
    files.some((file) => signal.pattern.test(file.path.toLowerCase())),
  )
}

export interface HeuristicAssessment {
  changeClass: ChangeClass
  changedFileCount: number
  scores: RiskScores
  rationale: string
}

/**
 * Score a pull request from the files it changed. A list the host cut short
 * scores as maximal on every axis, since what was not read cannot be vouched for.
 * Its class is `unknown` too, so no class rule can approve the part nobody read.
 */
export function assessChangedFiles(
  files: readonly ChangedFile[],
  truncated: boolean,
): HeuristicAssessment {
  const { changeClass, fileCount } = classifyChangedFiles(files.map((file) => file.path))
  if (truncated || fileCount === 0) {
    const why = truncated ? 'the host listed only part of the diff' : 'no changed files were listed'
    return {
      changeClass: 'unknown',
      changedFileCount: fileCount,
      scores: { complexity: 1, risk: 1, impact: 1 },
      rationale: `Scored as maximal because ${why}.`,
    }
  }
  const footprint = footprintOf(files)
  const sensitive = matched(files, SENSITIVE)
  const surfaces = matched(files, SURFACES)
  const scores = {
    complexity: complexityOf(footprint),
    risk: riskOf(changeClass, footprint, sensitive),
    impact: impactOf(changeClass, footprint, surfaces),
  }
  return {
    changeClass,
    changedFileCount: fileCount,
    scores,
    rationale: rationaleOf(changeClass, footprint, [...sensitive, ...surfaces]),
  }
}

function complexityOf(footprint: Footprint): number {
  return clamp(
    0.6 * saturate(footprint.weightedLines, 250) + 0.4 * saturate(footprint.codeFiles, 12),
  )
}

function riskOf(changeClass: ChangeClass, footprint: Footprint, sensitive: Signal[]): number {
  let risk = BASE_RISK[changeClass] + 0.25 * saturate(footprint.weightedLines, 400)
  for (const signal of sensitive) risk += signal.weight
  if (footprint.removedFiles > 0) risk += 0.1
  if (changeClass === 'source' && !footprint.touchesTests) risk += 0.1
  return clamp(risk)
}

function impactOf(changeClass: ChangeClass, footprint: Footprint, surfaces: Signal[]): number {
  if (changeClass === 'docs' || changeClass === 'test')
    return clamp(0.1 * saturate(footprint.areas, 4))
  let impact = 0.5 * saturate(footprint.areas, 4)
  for (const signal of surfaces) impact += signal.weight
  if (changeClass === 'dependency') impact += 0.15
  if (changeClass === 'schema') impact += 0.3
  return clamp(impact)
}

function rationaleOf(changeClass: ChangeClass, footprint: Footprint, signals: Signal[]): string {
  const parts = [
    `A ${changeClass} change over ${footprint.codeFiles} code file(s) in ${footprint.areas} area(s), about ${Math.round(footprint.weightedLines)} weighted changed lines.`,
  ]
  for (const signal of signals) parts.push(`It ${signal.label}.`)
  if (footprint.removedFiles > 0) parts.push(`It removes ${footprint.removedFiles} file(s).`)
  if (changeClass === 'source' && !footprint.touchesTests)
    parts.push('It changes code without touching a test.')
  return parts.join(' ')
}
