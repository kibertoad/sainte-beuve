import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('runs with nothing configured', () => {
    const config = loadConfig({})
    expect(config.port).toBe(8788)
    expect(config.corsOrigins).toStrictEqual(['*'])
    expect(config.catFactory).toBeNull()
    expect(config.github).toBeNull()
    expect(config.slack).toBeNull()
    expect(config.encryptionKey).toBeNull()
  })

  it('reads an empty encryption key as no key at all', () => {
    expect(loadConfig({ SETTINGS_ENCRYPTION_KEY: '' }).encryptionKey).toBeNull()
    expect(loadConfig({ SETTINGS_ENCRYPTION_KEY: 'a-key' }).encryptionKey).toBe('a-key')
  })

  it('treats a partly configured cat-factory as not configured', () => {
    // Two of the three values is a misconfiguration, not a usable client: a
    // half-built gateway would fail on the first delegation instead of on `/health`.
    const config = loadConfig({
      CAT_FACTORY_BASE_URL: 'http://localhost:8787',
      CAT_FACTORY_API_KEY: 'cf_live_x.y',
    })
    expect(config.catFactory).toBeNull()
  })

  it('builds the cat-factory config once all three values are present', () => {
    const config = loadConfig({
      CAT_FACTORY_BASE_URL: 'http://localhost:8787',
      CAT_FACTORY_API_KEY: 'cf_live_x.y',
      CAT_FACTORY_SERVICE_ID: 'svc-1',
    })
    expect(config.catFactory).toStrictEqual({
      baseUrl: 'http://localhost:8787',
      apiKey: 'cf_live_x.y',
      serviceId: 'svc-1',
      pipelineId: undefined,
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
