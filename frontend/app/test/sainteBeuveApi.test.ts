import type { Reviewer } from '@sainte-beuve/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiErrorMessage, createSainteBeuveApi } from '../app/utils/sainteBeuveApi'

/**
 * The contract-driven client, exercised without Nuxt around it.
 *
 * What these cases are for is the boundary itself rather than the list of
 * methods: that the path and the method come off the contract, and that a
 * payload the contract does not describe is refused HERE, naming the route,
 * instead of arriving in a component as an `undefined`.
 */

const API_BASE = 'https://sainte-beuve.example'

interface RecordedCall {
  url: string
  method: string
  body: string | undefined
}

/** Answer the next calls with these responses, and record what was sent. */
function stubFetch(...responses: (Response | Error)[]): RecordedCall[] {
  const calls: RecordedCall[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}): Promise<Response> => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : undefined,
    })
    const next = responses.shift()
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next ?? new Response(null, { status: 204 }))
  })
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const reviewer: Reviewer = {
  id: 'r-1',
  displayName: 'Ada',
  handles: { github: 'ada', gitlab: null },
  slackUserId: null,
  team: 'platform',
  skills: ['payments'],
  availability: 'available',
  role: 'member',
  weight: 1,
  outstandingReviews: 0,
  createdAt: 1_000,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSainteBeuveApi', () => {
  it('asks for the board with no filter, and folds one into the query when given', async () => {
    // The wire format the contract's schema parses back: one parameter per
    // status, the cap as a string, and neither key present at all when the
    // caller named none — the API's own default (the active statuses, capped)
    // is what the board wants, and a key that is present and undefined would go
    // out as an empty parameter the contract refuses.
    const calls = stubFetch(jsonResponse({ reviews: [] }), jsonResponse({ reviews: [] }))
    const api = createSainteBeuveApi(API_BASE)

    await api.listReviews()
    await api.listReviews({ status: ['open', 'closed'], limit: 20 })

    expect(calls.map((call) => call.url)).toEqual([
      `${API_BASE}/api/v1/reviews`,
      `${API_BASE}/api/v1/reviews?status=open&status=closed&limit=20`,
    ])
  })

  it('sends the method and path the contract declares, under the API version', async () => {
    const calls = stubFetch(jsonResponse({ reviewers: [reviewer] }))

    const answer = await createSainteBeuveApi(API_BASE).listReviewers()

    expect(answer.reviewers).toEqual([reviewer])
    expect(calls).toEqual([{ url: `${API_BASE}/api/v1/reviewers`, method: 'GET', body: undefined }])
  })

  it('resolves a path parameter through the contract, and sends the body as JSON', async () => {
    const calls = stubFetch(jsonResponse({ ...reviewer, availability: 'paused' }))

    await createSainteBeuveApi(API_BASE).updateReviewer('r-1', { availability: 'paused' })

    expect(calls[0]?.url).toBe(`${API_BASE}/api/v1/reviewers/r-1`)
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.body).toBe(JSON.stringify({ availability: 'paused' }))
  })

  it('builds the attention stream URL from its contract', () => {
    expect(createSainteBeuveApi(API_BASE).attentionStreamUrl).toBe(
      `${API_BASE}/api/v1/attention/stream`,
    )
  })

  // The point of the slice. A body missing a field its contract requires used to
  // reach a component and render as blank; now the call fails where it was made.
  it('refuses a response that does not match its contract, naming the route and the field', async () => {
    stubFetch(jsonResponse({ reviewers: [{ id: 'r-1', displayName: 'Ada' }] }))

    const failure = await createSainteBeuveApi(API_BASE)
      .listReviewers()
      .catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).code).toBe('contract_mismatch')
    expect(apiErrorMessage(failure)).toContain('GET /reviewers')
    expect(apiErrorMessage(failure)).toContain('reviewers.0.handles')
  })

  // The same gate on the way out, under its OWN code: nothing the contract forbids
  // leaves the browser, and the operator is told it was their value rather than the
  // route breaking its contract.
  it('refuses a request body the contract forbids, before anything is sent', async () => {
    const calls = stubFetch(jsonResponse(reviewer, 201))

    const failure = await createSainteBeuveApi(API_BASE)
      .createReviewer({ displayName: '' })
      .catch((err: unknown) => err)

    expect((failure as ApiError).code).toBe('invalid_request')
    expect(apiErrorMessage(failure)).toContain('displayName')
    expect(apiErrorMessage(failure)).not.toContain('did not match its contract')
    expect(calls).toEqual([])
  })

  it('carries the API refusal, with the code and the message it named', async () => {
    stubFetch(
      jsonResponse({ error: { code: 'unconfigured', message: 'GITHUB_TOKEN is not set' } }, 503),
    )

    const failure = await createSainteBeuveApi(API_BASE)
      .getWorkspace()
      .catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).statusCode).toBe(503)
    expect((failure as ApiError).code).toBe('unconfigured')
    expect(apiErrorMessage(failure)).toBe('GITHUB_TOKEN is not set')
  })

  it('names the field a 400 refused, which is the only place that says which one', async () => {
    stubFetch(
      jsonResponse(
        {
          error: {
            code: 'validation',
            message: 'Invalid request',
            details: [{ path: 'weight', message: 'Invalid type' }],
          },
        },
        400,
      ),
    )

    const failure = await createSainteBeuveApi(API_BASE)
      .updateReviewer('r-1', { availability: 'paused' })
      .catch((err: unknown) => err)

    expect(apiErrorMessage(failure)).toBe('Invalid request (weight)')
  })

  it('reports a status its contract does not describe as one', async () => {
    stubFetch(new Response(null, { status: 204 }))

    const failure = await createSainteBeuveApi(API_BASE)
      .listReviews()
      .catch((err: unknown) => err)

    expect((failure as ApiError).code).toBe('unexpected_response')
    expect(apiErrorMessage(failure)).toContain('GET /reviews')
  })

  // A backend that is not running is not a refusal, and must not be dressed up as
  // one: the screen says "could not reach the API" off the transport error.
  it('lets a transport failure through untouched', async () => {
    stubFetch(new TypeError('fetch failed'))

    const failure = await createSainteBeuveApi(API_BASE)
      .listReviewers()
      .catch((err: unknown) => err)

    expect(failure).not.toBeInstanceOf(ApiError)
    expect(apiErrorMessage(failure)).toBe('fetch failed')
  })
})
