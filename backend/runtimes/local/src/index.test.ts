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
})
