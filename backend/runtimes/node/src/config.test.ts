import { describe, expect, it } from 'vitest'
import { DEFAULT_SESSION_LIFETIME_MS } from '@sainte-beuve/server'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('runs with nothing configured', () => {
    const config = loadConfig({})
    expect(config.port).toBe(8788)
    expect(config.corsOrigins).toStrictEqual(['*'])
    expect(config.catFactory).toBeNull()
    expect(config.catFactoryApiKey).toBeNull()
    expect(config.slack).toStrictEqual({
      botToken: null,
      signingSecret: null,
      channelId: null,
    })
    expect(config.encryptionKey).toBeNull()
  })

  it('reads a blank DATABASE_URL as no database at all', () => {
    // Both example deployments ship the name with no value, and `--env-file`
    // reads that as `''`: without this it would hand node-postgres an empty
    // connection string instead of falling back to the in-memory store.
    expect(loadConfig({}).databaseUrl).toBeNull()
    expect(loadConfig({ DATABASE_URL: '' }).databaseUrl).toBeNull()
    expect(loadConfig({ DATABASE_URL: 'postgres://localhost/sb' }).databaseUrl).toBe(
      'postgres://localhost/sb',
    )
  })

  it('migrates at boot unless somebody says otherwise', () => {
    // The durable path is what an operator gets by leaving the variable out: a
    // deployment that silently skipped its migrations would answer requests
    // against a schema one release behind.
    expect(loadConfig({}).databaseMigrate).toBe(true)
    expect(loadConfig({ DATABASE_MIGRATE: '' }).databaseMigrate).toBe(true)
    expect(loadConfig({ DATABASE_MIGRATE: 'true' }).databaseMigrate).toBe(true)
  })

  it('takes every spelling of off for an answer', () => {
    // Somebody who typed `0` asked for the same thing as somebody who typed
    // `false`, and a deployment that gates schema changes on a human gets no
    // second chance to notice: the boot log names the store, not whether it
    // migrated.
    for (const off of ['false', 'FALSE', 'False', '0', 'no', 'off', ' off ']) {
      expect(loadConfig({ DATABASE_MIGRATE: off }).databaseMigrate).toBe(false)
    }
  })

  it('leaves the pool size to node-postgres unless it is a usable one', () => {
    expect(loadConfig({}).databaseMaxConnections).toBeUndefined()
    expect(loadConfig({ DATABASE_MAX_CONNECTIONS: '' }).databaseMaxConnections).toBeUndefined()
    expect(loadConfig({ DATABASE_MAX_CONNECTIONS: '20' }).databaseMaxConnections).toBe(20)
    // A ceiling of zero or less is a pool that is full before it hands out a
    // client: the boot waits for a connection for ever, so the process neither
    // becomes ready nor exits. The default is the only useful answer.
    expect(loadConfig({ DATABASE_MAX_CONNECTIONS: '0' }).databaseMaxConnections).toBeUndefined()
    expect(loadConfig({ DATABASE_MAX_CONNECTIONS: '-4' }).databaseMaxConnections).toBeUndefined()
  })

  it('reads an empty encryption key as no key at all', () => {
    expect(loadConfig({ SETTINGS_ENCRYPTION_KEY: '' }).encryptionKey).toBeNull()
    expect(loadConfig({ SETTINGS_ENCRYPTION_KEY: 'a-key' }).encryptionKey).toBe('a-key')
  })

  it('reads a base URL left blank as no base URL at all', () => {
    // Every example deployment ships `GITLAB_BASE_URL=` with no value, and `''`
    // as the base builds every path relative: `TypeError: Failed to parse URL`
    // on the first project, and a sign-in route that 500s.
    const config = loadConfig({ GITLAB_BASE_URL: '', GITHUB_API_BASE_URL: '' })
    expect(config.gitlab.baseUrl).toBeUndefined()
    expect(config.github.baseUrl).toBeUndefined()
    expect(loadConfig({ GITLAB_BASE_URL: 'https://gitlab.example.com' }).gitlab.baseUrl).toBe(
      'https://gitlab.example.com',
    )
  })

  it('treats a partly configured cat-factory as not configured', () => {
    // A base URL with no service id names no service, so a gateway built from it
    // would fail on the first delegation instead of on `/health`.
    expect(loadConfig({ CAT_FACTORY_BASE_URL: 'http://localhost:8787' }).catFactory).toBeNull()
  })

  it('keeps the cat-factory API key apart from the rest of its configuration', () => {
    // The key can also arrive from the Configuration screen, so it is not part of
    // "is cat-factory configured?": a deployment that sets the base URL and the
    // service id here can be finished from the SPA.
    const config = loadConfig({
      CAT_FACTORY_BASE_URL: 'http://localhost:8787',
      CAT_FACTORY_SERVICE_ID: 'svc-1',
    })
    expect(config.catFactory).toStrictEqual({
      baseUrl: 'http://localhost:8787',
      serviceId: 'svc-1',
      pipelineId: undefined,
    })
    expect(config.catFactoryApiKey).toBeNull()
  })

  it('offers whichever GitHub credentials are configured, and no others', () => {
    // They are not alternatives to choose between at boot: the strongest present
    // is what calls are made with, so a deployment can carry more than one.
    const none = loadConfig({}).github
    expect([none.token, none.app, none.oauth, none.webhookSecret]).toStrictEqual([
      null,
      null,
      null,
      null,
    ])

    const all = loadConfig({
      GITHUB_TOKEN: 'ghp_x',
      GITHUB_APP_ID: '1',
      GITHUB_APP_SLUG: 'sainte-beuve',
      GITHUB_APP_PRIVATE_KEY: 'pem',
      GITHUB_OAUTH_CLIENT_ID: 'Iv1.x',
      GITHUB_OAUTH_CLIENT_SECRET: 'secret',
      GITHUB_WEBHOOK_SECRET: 'hook',
      GITHUB_BOT_LOGIN: 'sainte-beuve-bot',
    }).github
    expect(all.app).toStrictEqual({ appId: '1', privateKeyPem: 'pem' })
    expect(all.oauth).toMatchObject({ clientId: 'Iv1.x', clientSecret: 'secret' })
    expect(all.appSlug).toBe('sainte-beuve')
    expect(all.botLogin).toBe('sainte-beuve-bot')
  })

  it('needs both halves of the App credential before it counts as one', () => {
    // The id signs the JWT and the key is what signs with it. One without the
    // other is a half-configured App, and offering an install for it would be a
    // button that fails at the first call.
    expect(loadConfig({ GITHUB_APP_ID: '1' }).github.app).toBeNull()
    expect(loadConfig({ GITHUB_APP_PRIVATE_KEY: 'pem' }).github.app).toBeNull()
  })

  it('ships the label conventions, overridable one at a time', () => {
    expect(loadConfig({}).github.labels).toStrictEqual({
      review: 'needs-review',
      aiReview: 'ai-review',
      skillPrefix: 'skill:',
    })
    expect(loadConfig({ GITHUB_LABEL_REVIEW: 'review-me' }).github.labels).toStrictEqual({
      review: 'review-me',
      aiReview: 'ai-review',
      skillPrefix: 'skill:',
    })
  })

  it('reads the two halves of Slack separately', () => {
    // Posting out needs a bot token and trusting what comes back needs the
    // signing secret; a deployment can have one and not the other.
    const config = loadConfig({ SLACK_BOT_TOKEN: 'xoxb-x', SLACK_CHANNEL_ID: 'C1' })
    expect(config.slack).toStrictEqual({
      botToken: 'xoxb-x',
      signingSecret: null,
      channelId: 'C1',
    })
  })

  it('falls back rather than crashing on a non-numeric port', () => {
    expect(loadConfig({ PORT: 'not-a-port' }).port).toBe(8788)
  })

  it('splits and trims a CORS origin list', () => {
    const origins = loadConfig({
      CORS_ORIGINS: 'https://a.example, https://b.example ',
    }).corsOrigins
    expect(origins).toStrictEqual(['https://a.example', 'https://b.example'])
  })

  it('names the SPA it was told about, so the wildcard default is not a trap', () => {
    // The client sends `credentials: 'include'` on every call and a browser
    // refuses any answer to one carrying `*`, so a hosted deployment left on the
    // default would lose every request rather than only its sign-in. The Worker
    // reads it the same way; see `corsOriginsFor`.
    expect(loadConfig({ APP_BASE_URL: 'https://board.example.com' }).corsOrigins).toStrictEqual([
      '*',
      'https://board.example.com',
    ])
    // Already listed, so nothing is added twice.
    expect(
      loadConfig({
        CORS_ORIGINS: 'https://board.example.com',
        APP_BASE_URL: 'https://board.example.com/configuration',
      }).corsOrigins,
    ).toStrictEqual(['https://board.example.com'])
  })

  it('falls back on a session lifetime that would expire on issue', () => {
    // The Worker rejects zero and below; this has to agree, or `0` on Node is a
    // sign-in that completes and silently never sticks.
    expect(loadConfig({}).auth.sessionLifetimeMs).toBe(DEFAULT_SESSION_LIFETIME_MS)
    expect(loadConfig({ AUTH_SESSION_LIFETIME_MS: '0' }).auth.sessionLifetimeMs).toBe(
      DEFAULT_SESSION_LIFETIME_MS,
    )
    expect(loadConfig({ AUTH_SESSION_LIFETIME_MS: '-1' }).auth.sessionLifetimeMs).toBe(
      DEFAULT_SESSION_LIFETIME_MS,
    )
    expect(loadConfig({ AUTH_SESSION_LIFETIME_MS: '60000' }).auth.sessionLifetimeMs).toBe(60_000)
  })
})
