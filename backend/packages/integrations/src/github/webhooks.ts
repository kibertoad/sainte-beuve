import type { CreateReviewRequest } from '@sainte-beuve/contracts'

/**
 * GitHub webhook intake.
 *
 * PLACEHOLDER: the signature check is real, the event mapping is not yet wired to
 * a service. What lands next is the `pull_request` / `pull_request_review` handling
 * that opens a review request when a PR is marked ready and resolves it on an
 * approval, so a team never has to register a review by hand. See
 * docs/implementation-plan.md, slice 3.
 */

/** The subset of the `pull_request` payload the intake reads. Widened as handlers land. */
export interface PullRequestEventPayload {
  action: string
  pull_request: {
    number: number
    title: string
    html_url: string
    draft: boolean
    user: { login: string } | null
  }
  repository: { name: string; owner: { login: string } }
}

/**
 * Verify `X-Hub-Signature-256` against the raw body.
 *
 * Written against WebCrypto rather than `node:crypto` because it has to run
 * unchanged inside workerd. The comparison is `timingSafeEqual`-shaped by hand
 * (WebCrypto's `verify` does the constant-time compare for us) so a mismatch leaks
 * nothing through timing.
 */
export async function verifyGitHubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = hexToBytes(signatureHeader.slice('sha256='.length))
  if (expected === null) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify('HMAC', key, expected, new TextEncoder().encode(rawBody))
}

// Backed by an explicit ArrayBuffer, not the default SharedArrayBuffer-compatible
// one: `crypto.subtle.verify` takes a `BufferSource`, which a
// `Uint8Array<ArrayBufferLike>` does not satisfy.
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) return null
    bytes[i] = byte
  }
  return bytes
}

/**
 * Map a `pull_request` event to the review request it should open, or null when the
 * event is not one we track (a draft, or an action other than opening/readying).
 */
export function reviewRequestFromPullRequestEvent(
  payload: PullRequestEventPayload,
): CreateReviewRequest | null {
  const tracked = payload.action === 'opened' || payload.action === 'ready_for_review'
  if (!tracked || payload.pull_request.draft) return null
  return {
    pullRequest: {
      provider: 'github',
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      number: payload.pull_request.number,
      url: payload.pull_request.html_url,
    },
    title: payload.pull_request.title,
    authorLogin: payload.pull_request.user?.login ?? 'unknown',
    requiredSkills: [],
    priority: 'normal',
    dueAt: null,
  }
}
