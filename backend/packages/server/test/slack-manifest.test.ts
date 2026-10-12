import type { SlackAppManifestResult } from '@sainte-beuve/contracts'
import { defaultOrg } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { withOrg } from '../src/container.js'
import { ApiKeyService } from '../src/modules/auth/ApiKeyService.js'
import { buildHarness, get, type TestHarness } from './helpers.js'

const MANIFEST = '/api/v1/settings/connections/slack/manifest'
const API = 'https://api.example.com'

async function manifestOf(
  harness: TestHarness,
  headers: Record<string, string> = {},
): Promise<SlackAppManifestResult> {
  const res = await harness.app.fetch(get(MANIFEST, headers))
  expect(res.status).toBe(200)
  return (await res.json()) as SlackAppManifestResult
}

/** A `required` deployment with a second org, and a key of the given role in it. */
async function namedOrg(role: 'admin' | 'member'): Promise<{
  harness: TestHarness
  headers: Record<string, string>
}> {
  const harness = buildHarness({
    apiBaseUrl: API,
    auth: {
      mode: 'required',
      environmentApiKey: null,
      sessionLifetimeMs: 60_000,
      devMode: false,
    },
  })
  await harness.container.stores.orgs.create({
    ...defaultOrg(),
    id: 'org-acme',
    slug: 'acme',
    name: 'Acme',
  })
  const { token } = await new ApiKeyService(withOrg(harness.container, 'org-acme')).mint({
    label: 'test',
    role,
    createdBy: null,
  })
  return { harness, headers: { authorization: `Bearer ${token}` } }
}

describe('the Slack app manifest', () => {
  it("is built for the default org on the deployment's public origin", async () => {
    const result = await manifestOf(buildHarness({ apiBaseUrl: API }))
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.requestUrl).toBe('https://api.example.com/webhooks/slack/default')
    expect(result.manifest.settings.interactivity.request_url).toBe(result.requestUrl)
    expect(result.manifest.features.slash_commands[0]?.url).toBe(result.requestUrl)
  })

  it("names the caller's org in the URL, from the credential rather than the request", async () => {
    const { harness, headers } = await namedOrg('admin')
    const result = await manifestOf(harness, headers)
    expect(result).toMatchObject({
      status: 'ready',
      requestUrl: 'https://api.example.com/webhooks/slack/acme',
      manifest: { display_information: { name: 'sainte-beuve (Acme)' } },
    })
  })

  it('is an admin route, like the rest of the configuration', async () => {
    const { harness, headers } = await namedOrg('member')
    expect((await harness.app.fetch(get(MANIFEST, headers))).status).toBe(403)
  })

  it('says what is missing when the deployment has no public origin', async () => {
    expect(await manifestOf(buildHarness({ apiBaseUrl: null }))).toStrictEqual({
      status: 'unavailable',
      missing: expect.stringContaining('set API_BASE_URL'),
    })
  })

  it('refuses an origin Slack would not post to', async () => {
    const result = await manifestOf(buildHarness({ apiBaseUrl: 'http://localhost:8788' }))
    expect(result).toStrictEqual({
      status: 'unavailable',
      missing: expect.stringContaining('https'),
    })
  })

  it('refuses an https origin on this machine, which Slack cannot reach', async () => {
    const result = await manifestOf(buildHarness({ apiBaseUrl: 'https://localhost:8788' }))
    expect(result).toStrictEqual({
      status: 'unavailable',
      missing: expect.stringContaining('public https URL'),
    })
  })

  it('names a malformed API_BASE_URL in the same sentence slot', async () => {
    const result = await manifestOf(buildHarness({ apiBaseUrl: 'https://api.example.com/v1' }))
    expect(result).toStrictEqual({
      status: 'unavailable',
      missing: expect.stringContaining('API_BASE_URL is an origin with no path'),
    })
  })
})
