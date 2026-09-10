import { describe, expect, it } from 'vitest'
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

  it('reads an empty encryption key as no key at all', () => {
    expect(loadConfig({ SETTINGS_ENCRYPTION_KEY: '' }).encryptionKey).toBeNull()
    expect(loadConfig({ SETTINGS_ENCRYPTION_KEY: 'a-key' }).encryptionKey).toBe('a-key')
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
})
