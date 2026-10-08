import type { AuthState, IssuedApiKey, Viewer } from '@sainte-beuve/contracts'
import { describe, expect, it } from 'vitest'
import { devModeFrom } from '../src/config/devMode.js'
import {
  addReviewer,
  buildHarness,
  cookieJar,
  environmentVcs,
  get,
  post,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

const ACT_AS = '/api/v1/dev/act-as'
const OPERATOR_KEY = 'an-operator-key-that-is-long-enough-to-hold'

/** An `open` laptop whose GitHub token acts as `kibertoad`, with persona switching on or off. */
function laptop(devMode = true): TestHarness {
  const base = buildHarness()
  return buildHarness({
    vcs: environmentVcs(viewerVcs('kibertoad')),
    auth: { ...base.container.auth, devMode, environmentApiKey: OPERATOR_KEY },
  })
}

async function me(harness: TestHarness, headers: Record<string, string>): Promise<Viewer> {
  const res = await harness.app.fetch(get('/api/v1/me', headers))
  expect(res.status).toBe(200)
  return (await res.json()) as Viewer
}

describe('acting as a persona', () => {
  it('is refused, naming the variable, unless DEV_MODE is on', async () => {
    const harness = laptop(false)
    const persona = await addReviewer(harness, { displayName: 'Reviewer persona' })

    const res = await harness.app.fetch(post(ACT_AS, { reviewerId: persona.id }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining('DEV_MODE=true') },
    })
  })

  it('renders every screen for the persona, on the account that switched', async () => {
    const harness = laptop()
    const persona = await addReviewer(harness, { displayName: 'Reviewer persona' })
    const jar = cookieJar()

    const res = await harness.app.fetch(post(ACT_AS, { reviewerId: persona.id }))
    jar.keep(res)

    expect(res.status).toBe(200)
    const state = (await res.json()) as AuthState
    expect(state.devMode).toBe(true)
    expect(state.principal).toMatchObject({
      kind: 'session',
      // The GitHub account behind the deployment's token established it.
      session: { provider: 'github', subject: 'subject-kibertoad' },
      viewer: { reviewer: { id: persona.id } },
    })
    expect((await me(harness, jar.headers())).reviewer.id).toBe(persona.id)
    // Without the cookie, the open deployment is the token's own person again.
    expect((await me(harness, {})).reviewer.handles.github).toBe('kibertoad')
  })

  it('drops the session it replaces when switching from one persona to another', async () => {
    const harness = laptop()
    const author = await addReviewer(harness, { displayName: 'Author persona' })
    const reviewer = await addReviewer(harness, { displayName: 'Reviewer persona' })
    const first = cookieJar()
    first.keep(await harness.app.fetch(post(ACT_AS, { reviewerId: author.id })))

    const second = cookieJar()
    const res = await harness.app.fetch(post(ACT_AS, { reviewerId: reviewer.id }, first.headers()))
    second.keep(res)

    expect(res.status).toBe(200)
    expect((await me(harness, second.headers())).reviewer.id).toBe(reviewer.id)
    // The author's cookie no longer resolves, so it falls back to the token's person.
    expect((await me(harness, first.headers())).reviewer.handles.github).toBe('kibertoad')
  })

  it('refuses a paused person, as a sign-in does', async () => {
    const harness = laptop()
    const persona = await addReviewer(harness, {
      displayName: 'Away persona',
      availability: 'paused',
    })

    const res = await harness.app.fetch(post(ACT_AS, { reviewerId: persona.id }))

    expect(res.status).toBe(403)
  })

  it('answers 404 for a row that is not in the directory', async () => {
    const res = await laptop().app.fetch(post(ACT_AS, { reviewerId: 'nobody' }))

    expect(res.status).toBe(404)
  })

  it('refuses an API key, which is not a person', async () => {
    const harness = laptop()
    const persona = await addReviewer(harness, { displayName: 'Reviewer persona' })
    const minted = await harness.app.fetch(
      post(
        '/api/v1/settings/api-keys',
        { label: 'ci', role: 'admin' },
        { authorization: `Bearer ${OPERATOR_KEY}` },
      ),
    )
    const { token } = (await minted.json()) as IssuedApiKey

    const res = await harness.app.fetch(
      post(ACT_AS, { reviewerId: persona.id }, { authorization: `Bearer ${token}` }),
    )

    expect(res.status).toBe(403)
  })
})

describe('devModeFrom', () => {
  const LOCAL = { appBaseUrl: null, corsOrigins: ['*'] }

  it('is off unless somebody typed true', () => {
    expect(devModeFrom({ ...LOCAL, value: undefined })).toBe(false)
    expect(devModeFrom({ ...LOCAL, value: '' })).toBe(false)
    expect(devModeFrom({ ...LOCAL, value: 'false' })).toBe(false)
    expect(devModeFrom({ ...LOCAL, value: ' True ' })).toBe(true)
  })

  it('refuses a value it cannot read rather than guessing', () => {
    expect(() => devModeFrom({ ...LOCAL, value: 'yes' })).toThrow(/DEV_MODE/)
  })

  it('refuses to run beside a public origin', () => {
    expect(() =>
      devModeFrom({ value: 'true', appBaseUrl: 'https://sb.example.com', corsOrigins: ['*'] }),
    ).toThrow(/sb\.example\.com/)
    expect(
      devModeFrom({ value: 'true', appBaseUrl: 'http://localhost:3000', corsOrigins: ['*'] }),
    ).toBe(true)
  })
})
