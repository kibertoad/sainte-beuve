import { applyD1Migrations, type D1Migration, env, SELF } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

// A smoke suite, deliberately thin. The behaviour lives in @sainte-beuve/server and
// is tested there; what only this suite can tell us is that the bundle boots on
// workerd and that the facade's own wiring (routes mounted, capabilities read off
// the env) survives the runtime.
const TOKEN_URL = 'https://example.com/api/v1/settings/integrations/cat-factory/token'
const CONNECTIONS_URL = 'https://example.com/api/v1/settings/connections'

// The bindings `vitest.config.ts` hands the suite, declared where the pool
// reads `env`'s type from: `Cloudflare.Env` is the extension point the runtime
// types name, and the declarations merge.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

describe('sainte-beuve worker', () => {
  beforeAll(async () => {
    // The schema this facade's D1 binding needs, applied exactly as
    // `wrangler d1 migrations apply` applies it. The store conformance suite
    // lives in @sainte-beuve/persistence-d1; what this one adds is that the
    // FACADE reaches the binding at all.
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    // The pool hands the whole file ONE database and does not roll it back
    // between cases, so the credential the sealing case stores would otherwise
    // still be there for the two cases that read the credential surface after
    // it. Emptied here rather than after the case that writes it, so a case
    // added later inherits the guarantee instead of the leftovers.
    await env.DB.prepare('DELETE FROM integration_tokens').run()
  })

  it('serves the health probe', async () => {
    const res = await SELF.fetch('https://example.com/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({
      status: 'ok',
      // wrangler.toml binds a D1 database, so this is the facade reporting the
      // store it actually resolved rather than the one it was written for. A
      // Worker with no binding falls back to memory and says `memory` here.
      persistence: 'd1',
      // And the probe READ that database, which is the half a binding cannot
      // promise: this suite applies the migrations, and a deployment that
      // skipped them gets `false` and a 503 instead of this.
      persistenceReady: true,
      // The suite's env carries an encryption key and nothing else, so the flags
      // are read off the bindings rather than reported from a fixed table. The
      // inbound pair is separate from the outbound one: posting to Slack needs a
      // bot token, and trusting a slash command needs the signing secret.
      capabilities: {
        chat: false,
        vcs: { github: false, gitlab: false },
        aiReview: false,
        secrets: true,
        githubWebhooks: false,
        slackInteractivity: false,
      },
    })
  })

  it('serves the review board', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/reviews')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ reviews: [] })
  })

  it('lets the SPA in on the origins its bindings list', async () => {
    // wrangler.toml sets CORS_ORIGINS = "*", and the app is built once per isolate,
    // so this is also the proof that the per-request `env` still reaches the
    // origin decision.
    const res = await SELF.fetch('https://example.com/api/v1/reviews', {
      headers: { origin: 'http://localhost:3000' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('seals and reads back a credential with the runtime Web Crypto', async () => {
    const stored = await SELF.fetch(TOKEN_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'cf_live_9f8e7d6c5b4a' }),
    })
    expect(stored.status).toBe(200)

    // `stored` (rather than `unreadable`) is the assertion that matters: it is
    // reported only after the envelope has been recognised as this key's, so this
    // covers HKDF, the key id and AES-GCM inside workerd. `inUse` stays false
    // because this Worker's bindings wire no cat-factory gateway.
    const listed = await SELF.fetch('https://example.com/api/v1/settings/integrations')
    const { integrations } = (await listed.json()) as {
      integrations: { integrationId: string; state: string; hint: string | null; inUse: boolean }[]
    }
    expect(integrations.find((row) => row.integrationId === 'cat-factory')).toMatchObject({
      state: 'stored',
      hint: '5b4a',
      inUse: false,
    })
  })

  it('offers only the connections its bindings can actually make', async () => {
    // The one thing only this suite can prove about the connect surface: the
    // Worker resolves it from the per-request `env`, so a facade that forgot to
    // pass the bindings through would report a deployment it is not.
    const res = await SELF.fetch(CONNECTIONS_URL)
    expect(res.status).toBe(200)
    // `GITHUB_LABEL_REVIEW` is bound BLANK in this suite and reads as the
    // default: an empty label would match nothing, so labelling a pull request
    // would silently do nothing at all while the screen showed an empty
    // `<code>` and no fault.
    const labels = { review: 'needs-review', aiReview: 'ai-review', skillPrefix: 'skill:' }
    expect(await res.json()).toStrictEqual({
      vcs: [
        {
          provider: 'github',
          // An encryption key is set and nothing else, so a pasted token is the
          // one credential this Worker could hold.
          activeMethod: null,
          availableMethods: ['pat'],
          appInstallable: false,
          account: null,
          inboundIntake: true,
          webhooksReady: false,
          botLogin: null,
          labels,
        },
        {
          // Every host an adapter exists for is reported, connected or not:
          // "GitLab is not connected" and "this build cannot reach GitLab" are
          // different answers, and only the first is true here.
          provider: 'gitlab',
          activeMethod: null,
          availableMethods: ['pat'],
          appInstallable: false,
          account: null,
          inboundIntake: false,
          webhooksReady: false,
          botLogin: null,
          labels,
        },
      ],
      slack: { ready: false, announcementChannelId: null, interactivityReady: false },
    })
  })

  it('refuses an inbound delivery it has no secret to verify', async () => {
    // The route is registered in a GitHub App by hand, so it has to answer on
    // the runtime it is registered against, and answer honestly.
    //
    // The suite's `GITHUB_WEBHOOK_SECRET` is BLANK rather than absent, which is
    // the state a copied `.dev.vars.example` leaves it in. A facade reading it
    // with `??` would pass `''` to a guard that refuses only null, and workerd
    // refuses a zero-length HMAC key: GitHub would be answered 500 by a Worker
    // whose /health calls the capability ready.
    const res = await SELF.fetch('https://example.com/webhooks/github', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-GitHub-Event': 'ping' },
      body: '{}',
    })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: { code: 'unavailable', message: expect.stringContaining('GITHUB_WEBHOOK_SECRET') },
    })
  })

  it('signs a connect state with the runtime Web Crypto and refuses a forged one', async () => {
    // HKDF plus HMAC inside workerd, which is the other adapter that ships
    // INSIDE the bundle rather than behind a network call. The Worker has no
    // OAuth client, so the sign-in route is the wrong probe; the callback is
    // where a state is checked.
    const res = await SELF.fetch('https://example.com/connect/github/callback?code=x&state=forged')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'validation' } })
  })

  it('keeps the credential routes off the wildcard its bindings list', async () => {
    // Same `CORS_ORIGINS = "*"` the board is served under, and a PUT that writes a
    // credential does not get it: an operator's browser must not be able to carry
    // a drive-by page's request into this deployment's token store.
    const preflight = await SELF.fetch(TOKEN_URL, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'PUT' },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers the error envelope for an unknown route', async () => {
    const res = await SELF.fetch('https://example.com/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
