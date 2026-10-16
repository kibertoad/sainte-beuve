import type { CatFactoryPersonal } from '@sainte-beuve/contracts'
import {
  type AiReviewGateway,
  type CatFactoryReviewTarget,
  ConflictError,
  type GuidedReviewGateway,
  UnavailableError,
} from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { writeCatFactoryConfig } from '../src/integrations/catFactoryConfig.js'
import { AiReviewService } from '../src/modules/reviews/AiReviewService.js'
import { stubAiReview } from './ai-review-doubles.js'
import { catFactoryWired, connectCatFactory } from './cat-factory-harness.js'
import {
  buildHarness,
  environmentVcs,
  get,
  openReview,
  PR,
  post,
  put,
  stubGateways,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// AI reviews on a person's own model subscription, over `app.fetch`. What is
// under test is which key and password each call reaches cat-factory with, and
// what the org learns from cat-factory refusing its own key.

const ORG_KEY = 'cf_live_test.secret'
const PERSONAL_KEY = 'cf_live_mine.secret'
const PASSWORD = { 'x-personal-password': 'open sesame' }

const upstream = (reason: string, vendor?: string) => ({
  upstream: 'cat-factory',
  reason,
  ...(vendor === undefined ? {} : { vendor }),
})

interface Personal {
  harness: TestHarness
  targets: CatFactoryReviewTarget[]
  /** What the next filing throws, once; null files it. */
  refuse: Error | null
  /** The scope the probe reports for a key being stored. */
  scope: string
}

async function personalDeployment(): Promise<Personal> {
  const state: Personal = { harness: null as never, targets: [], refuse: null, scope: 'decide' }
  const stub = stubAiReview()
  const gateway: AiReviewGateway = {
    ...stub,
    requestReview: async (input) => {
      const refusal = state.refuse
      state.refuse = null
      if (refusal !== null) throw refusal
      return stub.requestReview(input)
    },
  }
  state.harness = await connectCatFactory(
    buildHarness({
      ...catFactoryWired({}),
      vcs: environmentVcs(viewerVcs('ada')),
      gateways: stubGateways({
        aiReview: (target) => {
          state.targets.push(target)
          return gateway
        },
        // Built to report the capability when the settings are read back; never called here.
        guidedReview: () => ({}) as GuidedReviewGateway,
        catFactoryProbe: () => ({
          probe: async () => ({
            outcome: 'ok',
            detail: null,
            scope: state.scope,
            services: [],
            pipelines: [],
          }),
        }),
      }),
    }),
  )
  return state
}

let pullRequests = 0

/** A review of a pull request no earlier case opened, so each filing gets its own board row. */
function review(state: Personal) {
  pullRequests += 1
  const number = pullRequests
  return openReview(state.harness, {
    pullRequest: { ...PR, number, url: `https://github.com/${PR.owner}/${PR.repo}/pull/${number}` },
  })
}

async function file(state: Personal, headers: Record<string, string> = {}): Promise<Response> {
  const opened = await review(state)
  return state.harness.app.fetch(post(`/api/v1/reviews/${opened.id}/ai-review`, {}, headers))
}
async function need(res: Response): Promise<unknown> {
  expect(res.status).toBe(409)
  const body = (await res.json()) as { error: { details?: { need?: unknown } } }
  return body.error.details?.need
}

async function personal(state: Personal): Promise<CatFactoryPersonal> {
  const res = await state.harness.app.fetch(get('/api/v1/me/cat-factory'))
  expect(res.status).toBe(200)
  return (await res.json()) as CatFactoryPersonal
}

async function storeKey(state: Personal): Promise<void> {
  const res = await state.harness.app.fetch(
    put('/api/v1/me/cat-factory/key', { token: PERSONAL_KEY }),
  )
  expect(res.status).toBe(200)
}

describe('AI reviews on a personal subscription', () => {
  let state: Personal

  beforeEach(async () => {
    state = await personalDeployment()
  })

  it('files with the org key until cat-factory refuses it a personal model', async () => {
    expect((await file(state)).status).toBe(202)
    expect(state.targets.at(-1)).toMatchObject({ apiKey: ORG_KEY, personalPassword: null })
    expect((await personal(state)).personalRoute).toBe('not_known')
  })

  it('learns the org needs the personal route, and asks for a key first', async () => {
    state.refuse = new ConflictError('refused', upstream('individual_model_unsupported'))
    expect(await need(await file(state))).toBe('personal_key')
    expect(await personal(state)).toStrictEqual({
      personalRoute: 'required',
      key: { stored: false, hint: null },
    })
  })

  it('goes straight to the personal key once learned, and asks for the password without calling cat-factory', async () => {
    state.refuse = new ConflictError('refused', upstream('providers_unconfigured'))
    await file(state)
    await storeKey(state)
    const before = state.targets.length

    expect(await need(await file(state))).toBe('password')
    expect(state.targets).toHaveLength(before)

    expect((await file(state, PASSWORD)).status).toBe(202)
    expect(state.targets.at(-1)).toMatchObject({
      apiKey: PERSONAL_KEY,
      personalPassword: 'open sesame',
    })
  })

  it('asks to retry when the person already had a key and a password when the route was learned', async () => {
    await storeKey(state)
    state.refuse = new ConflictError('refused', upstream('individual_model_unsupported'))
    expect(await need(await file(state, PASSWORD))).toBe('retry')
  })

  it('refuses a filing for a run already in flight before asking for the password', async () => {
    state.refuse = new ConflictError('refused', upstream('individual_model_unsupported'))
    await file(state)
    await storeKey(state)
    const opened = await review(state)
    const url = `/api/v1/reviews/${opened.id}/ai-review`
    expect((await state.harness.app.fetch(post(url, {}, PASSWORD))).status).toBe(202)

    expect(await need(await state.harness.app.fetch(post(url, {})))).toBeUndefined()
  })

  it('refuses a filing nobody asked for once the route is learned, without calling cat-factory', async () => {
    state.refuse = new ConflictError('refused', upstream('individual_model_unsupported'))
    await file(state)
    const opened = await review(state)
    const before = state.targets.length

    await expect(
      new AiReviewService(state.harness.container).request(opened.id, null),
    ).rejects.toThrow(/requested by a person/)
    expect(state.targets).toHaveLength(before)
    expect(await state.harness.container.repositories.aiReviewRuns.listByReview(opened.id)).toEqual(
      [],
    )
  })

  it("passes on cat-factory's refusal of the person's password", async () => {
    state.refuse = new ConflictError('refused', upstream('individual_model_unsupported'))
    await file(state)
    await storeKey(state)
    state.refuse = new UnavailableError('refused', upstream('wrong_password', 'claude'))

    const res = await file(state, PASSWORD)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { details: unknown } }).error.details).toStrictEqual({
      reason: 'cat_factory_personal_route',
      need: 'wrong_password',
      vendor: 'claude',
    })
  })

  it('polls a run on the org key, needing no password', async () => {
    state.refuse = new ConflictError('refused', upstream('individual_model_unsupported'))
    await file(state)
    await storeKey(state)
    const opened = await review(state)
    await state.harness.app.fetch(post(`/api/v1/reviews/${opened.id}/ai-review`, {}, PASSWORD))

    const read = await state.harness.app.fetch(get(`/api/v1/reviews/${opened.id}/ai-review`))
    expect(read.status).toBe(200)
    expect(state.targets.at(-1)).toMatchObject({ apiKey: ORG_KEY })
  })

  it('forgets the learned route when the cat-factory settings are saved', async () => {
    state.refuse = new ConflictError('refused', upstream('individual_model_unsupported'))
    await file(state)
    const saved = await state.harness.app.fetch(
      put('/api/v1/settings/connections/cat-factory', {
        baseUrl: 'https://cat-factory.example.com',
        serviceId: 'svc-1',
        pipelineId: 'pl_other',
      }),
    )
    expect(saved.status).toBe(200)
    expect((await personal(state)).personalRoute).toBe('not_known')
  })

  it('refuses to store a key that cannot answer a review', async () => {
    state.scope = 'write'
    const res = await state.harness.app.fetch(
      put('/api/v1/me/cat-factory/key', { token: PERSONAL_KEY }),
    )
    expect(res.status).toBe(400)
    expect((await personal(state)).key.stored).toBe(false)
  })

  it("drops everybody's personal key when the org moves to another instance", async () => {
    await storeKey(state)
    await writeCatFactoryConfig(state.harness.container, {
      baseUrl: 'https://cat-factory.example.com',
      appUrl: null,
      serviceId: 'svc-1',
      pipelineId: null,
    })
    await state.harness.app.fetch(
      put('/api/v1/settings/connections/cat-factory', {
        baseUrl: 'https://elsewhere.example.com',
        serviceId: null,
        pipelineId: null,
      }),
    )
    expect((await personal(state)).key.stored).toBe(false)
  })
})
