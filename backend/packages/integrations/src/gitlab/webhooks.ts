import { timingSafeEqual } from '@sainte-beuve/kernel'

/**
 * GitLab webhook verification.
 *
 * GitLab does not sign a delivery. It sends the secret token configured on the
 * webhook back verbatim in `X-Gitlab-Token`, so verifying is comparing that
 * header with the stored secret. Both sides are hashed first and the digests
 * compared, so the comparison takes the same time whatever the header's length
 * and however much of it matches.
 *
 * Written against WebCrypto rather than `node:crypto` because it has to run
 * unchanged inside workerd.
 */
export async function verifyGitLabToken(
  secret: string,
  tokenHeader: string | null,
): Promise<boolean> {
  if (tokenHeader === null || tokenHeader.length === 0) return false
  const [expected, provided] = await Promise.all([digest(secret), digest(tokenHeader)])
  return timingSafeEqual(expected, provided)
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}
