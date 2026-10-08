import type { CatFactoryCheck, CatFactoryConnection } from '@sainte-beuve/contracts'
import type {
  CatFactoryAccess,
  CatFactoryProbeReport,
  GuidedReviewGateway,
} from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { withOrg } from '../src/container.js'
import { resolveAiReview } from '../src/integrations/resolve.js'
import { stubAiReview } from './ai-review-doubles.js'
import { buildHarness, del, get, post, put, stubGateways, type TestHarness } from './helpers.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'

const CONFIG_PATH = '/api/v1/settings/connections/cat-factory'
const CHECK_PATH = `${CONFIG_PATH}/check`

const LOCAL = { baseUrl: 'http://localhost:8787', serviceId: 'blk_api', pipelineId: 'pl_review' }

const ACCEPTED: CatFactoryProbeReport = {
  outcome: 'ok',
  detail: null,
  scope: 'decide',
  services: [{ id: 'blk_api', title: 'API' }],
  pipelines: [{ id: 'pl_review', name: 'Review a pull request' }],
}

/** A deployment whose probe answers with `report`, recording the access each check used. */
function probing(report: CatFactoryProbeReport): {
  harness: TestHarness
  asked: CatFactoryAccess[]
} {
  const asked: CatFactoryAccess[] = []
  const wired = catFactoryWired({})
  const harness = buildHarness({
    ...wired,
    gateways: stubGateways({
      catFactoryProbe: (access) => {
        asked.push(access)
        return { probe: async () => report }
      },
    }),
  })
  return { harness, asked }
}

async function check(harness: TestHarness, body: unknown): Promise<CatFactoryCheck> {
  const res = await harness.app.fetch(post(CHECK_PATH, body))
  expect(res.status).toBe(200)
  return (await res.json()) as CatFactoryCheck
}

function outcomes(result: CatFactoryCheck): Record<string, string> {
  return Object.fromEntries(result.steps.map((s) => [s.step, s.outcome]))
}

describe('configuring cat-factory', () => {
  it('stores the settings for the org that saved them, and clears them', async () => {
    const harness = buildHarness()
    const saved = await harness.app.fetch(put(CONFIG_PATH, LOCAL))
    expect(await saved.json()).toMatchObject({ config: LOCAL, aiReviewReady: false })

    const other = withOrg(harness.container, 'org-other')
    expect(await other.repositories.integrationConfigs.get('cat-factory')).toBeNull()

    const cleared = (await (
      await harness.app.fetch(del(CONFIG_PATH))
    ).json()) as CatFactoryConnection
    expect(cleared.config).toBeNull()
  })

  it('refuses a base URL that is not http or https', async () => {
    const res = await buildHarness().app.fetch(
      put(CONFIG_PATH, { ...LOCAL, baseUrl: 'ftp://cat-factory.example.com' }),
    )
    expect(res.status).toBe(400)
  })

  it('tells any member whether the reviewers can run', async () => {
    const harness = buildHarness(
      catFactoryWired({ aiReview: stubAiReview(), guidedReview: {} as GuidedReviewGateway }),
    )
    const before = await harness.app.fetch(get('/api/v1/capabilities'))
    expect(await before.json()).toStrictEqual({ aiReview: false, guidedReview: false })
    await connectCatFactory(harness)
    const after = await harness.app.fetch(get('/api/v1/capabilities'))
    expect(await after.json()).toStrictEqual({ aiReview: true, guidedReview: true })
  })

  it("does not lend one org's cat-factory to another", async () => {
    const harness = await connectCatFactory(
      buildHarness(catFactoryWired({ aiReview: stubAiReview() })),
    )
    expect(await resolveAiReview(harness.container)).not.toBeNull()
    expect(await resolveAiReview(withOrg(harness.container, 'org-other'))).toBeNull()
  })
})

describe('checking a cat-factory configuration', () => {
  it('fails on the key, and checks nothing else, when there is none', async () => {
    const { harness, asked } = probing(ACCEPTED)
    const result = await check(harness, LOCAL)
    expect(result.ok).toBe(false)
    expect(outcomes(result)).toMatchObject({ key: 'failed', reachable: 'skipped' })
    expect(asked).toStrictEqual([])
  })

  it('passes a key with the decide scope that can see the service and the pipeline', async () => {
    const { harness, asked } = probing(ACCEPTED)
    const result = await check(harness, { ...LOCAL, apiKey: 'cf_live_entered.secret' })
    expect(result.ok).toBe(true)
    expect(result.services).toStrictEqual(ACCEPTED.services)
    expect(asked).toStrictEqual([{ baseUrl: LOCAL.baseUrl, apiKey: 'cf_live_entered.secret' }])
  })

  it('falls back to the stored key when none is entered', async () => {
    const { harness, asked } = probing(ACCEPTED)
    await connectCatFactory(harness)
    await check(harness, LOCAL)
    expect(asked[0]?.apiKey).toBe('cf_live_test.secret')
  })

  it('points at the URL when nothing answers there', async () => {
    const { harness } = probing({
      ...ACCEPTED,
      outcome: 'unreachable',
      detail: 'ECONNREFUSED',
      scope: null,
    })
    const result = await check(harness, { ...LOCAL, apiKey: 'cf_live_entered.secret' })
    expect(outcomes(result)).toMatchObject({
      reachable: 'failed',
      authenticated: 'skipped',
      service: 'skipped',
    })
    expect(result.steps.find((s) => s.step === 'reachable')?.message).toContain('ECONNREFUSED')
  })

  it('names a scope too low to file reviews, and a service the key cannot see', async () => {
    const { harness } = probing({ ...ACCEPTED, scope: 'write' })
    const result = await check(harness, {
      ...LOCAL,
      serviceId: 'blk_gone',
      apiKey: 'cf_live_entered.secret',
    })
    expect(result.ok).toBe(false)
    expect(outcomes(result)).toMatchObject({
      scope: 'failed',
      service: 'failed',
      pipeline: 'passed',
    })
  })

  it('skips what was left out rather than failing it', async () => {
    const { harness } = probing(ACCEPTED)
    const result = await check(harness, {
      ...LOCAL,
      serviceId: null,
      pipelineId: null,
      apiKey: 'cf_live_entered.secret',
    })
    expect(result.ok).toBe(true)
    expect(outcomes(result)).toMatchObject({ service: 'skipped', pipeline: 'skipped' })
  })
})
