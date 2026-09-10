import { describe, expect, it } from 'vitest'
import { localConfig } from './index.js'

describe('localConfig', () => {
  it('defaults cat-factory to a local instance, with no account needed', () => {
    const config = localConfig({ CAT_FACTORY_API_KEY: 'cf_live_x.y', CAT_FACTORY_SERVICE_ID: 's' })
    expect(config.catFactory?.baseUrl).toBe('http://localhost:8787')
  })

  it('lets the environment point at the centralized instance instead', () => {
    const config = localConfig({
      CAT_FACTORY_BASE_URL: 'https://cat-factory.example.com',
      CAT_FACTORY_API_KEY: 'cf_live_x.y',
      CAT_FACTORY_SERVICE_ID: 's',
    })
    expect(config.catFactory?.baseUrl).toBe('https://cat-factory.example.com')
  })

  it('runs with no Slack workspace and no GitHub app at all', () => {
    const config = localConfig({})
    expect(config.slack).toBeNull()
    expect(config.github).toBeNull()
    expect(config.corsOrigins).toStrictEqual(['*'])
  })

  it('generates a per-boot encryption key, so the Configuration screen works unset', () => {
    // 32 bytes, base64: what the cipher refuses to run on anything shorter than.
    const key = localConfig({}).encryptionKey ?? ''
    expect(Buffer.from(key, 'base64')).toHaveLength(32)
    expect(localConfig({}).encryptionKey).not.toBe(key)
  })

  it('pins the key to the environment when a deployment supplies one', () => {
    expect(localConfig({ SETTINGS_ENCRYPTION_KEY: 'from-the-env' }).encryptionKey).toBe(
      'from-the-env',
    )
  })

  it('still generates one when a copied .env carries the name with no value', () => {
    // `deploy/local/.env.example` ships `SETTINGS_ENCRYPTION_KEY=`, and
    // `--env-file` reads that as `''`. Treated as a value, it would override the
    // per-boot key and turn the Configuration screen off in the one mode that
    // promises it needs no configuration at all.
    const key = localConfig({ SETTINGS_ENCRYPTION_KEY: '' }).encryptionKey ?? ''
    expect(Buffer.from(key, 'base64')).toHaveLength(32)
  })
})
