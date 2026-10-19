import type { AiReviewFinding, PullRequestRef } from '@sainte-beuve/contracts'
import { isWebUrl } from '@sainte-beuve/contracts'

/**
 * A link to a finding on the pull request's "Files changed" page, or null when
 * the pull request has no URL a link may use.
 *
 * Built from the pull request's own URL, as `anchorHref` is, because a
 * self-hosted host has no address anything here could guess.
 *
 * GitHub names a file `diff-<sha256(path)>` and a line `R<n>` or `L<n>` after
 * it. GitLab names a file by `sha1(path)`; its line anchor needs both the old and
 * the new line number, which a finding does not carry, so a GitLab link stops at
 * the file.
 */
export async function filesChangedHref(
  pullRequest: Pick<PullRequestRef, 'provider' | 'url'>,
  finding: Pick<AiReviewFinding, 'path' | 'line' | 'side'>,
): Promise<string | null> {
  if (!isWebUrl(pullRequest.url)) return null
  const base = pullRequest.url.replace(/[?#].*$/, '').replace(/\/+$/, '')
  if (pullRequest.provider === 'gitlab') {
    return `${base}/diffs#${await hexDigest('SHA-1', finding.path)}`
  }
  const file = `diff-${await hexDigest('SHA-256', finding.path)}`
  return `${base}/files#${file}${githubLineSuffix(finding)}`
}

function githubLineSuffix(finding: Pick<AiReviewFinding, 'line' | 'side'>): string {
  if (finding.line === null) return ''
  return `${finding.side === 'LEFT' ? 'L' : 'R'}${finding.line}`
}

async function hexDigest(algorithm: 'SHA-1' | 'SHA-256', text: string): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
