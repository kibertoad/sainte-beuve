import { describe, expect, it } from 'vitest'
import { verifyGitLabToken } from './webhooks.js'

// The gate every GitLab delivery passes: GitLab sends the webhook's secret token
// back verbatim, so this is a comparison. What a verified delivery MEANS is
// events.test.ts.

const SECRET = 'gitlab-webhook-secret'

describe('verifyGitLabToken', () => {
  it('accepts the configured token', async () => {
    expect(await verifyGitLabToken(SECRET, SECRET)).toBe(true)
  })

  it('rejects another token, including one that shares a prefix', async () => {
    expect(await verifyGitLabToken(SECRET, 'gitlab-webhook-secreT')).toBe(false)
    expect(await verifyGitLabToken(SECRET, 'gitlab-webhook')).toBe(false)
    expect(await verifyGitLabToken(SECRET, `${SECRET}-and-more`)).toBe(false)
  })

  it('rejects a missing or empty header', async () => {
    expect(await verifyGitLabToken(SECRET, null)).toBe(false)
    expect(await verifyGitLabToken(SECRET, '')).toBe(false)
  })
})
