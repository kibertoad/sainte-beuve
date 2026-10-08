import assert from 'node:assert/strict'
import type { StoredIntegrationConfig } from '@sainte-beuve/kernel'
import { type ConformanceCase, conformanceCase } from './case.js'
import { type TenancyCase, tenancyCase } from './tenancy-cases.js'

function config(
  integrationId: string,
  values: Record<string, string>,
  updatedAt = 1_000,
): StoredIntegrationConfig {
  return { integrationId, values, updatedAt }
}

export const integrationConfigCases: readonly ConformanceCase[] = [
  conformanceCase('integration settings are stored once per integration', async (repos) => {
    const first = config('cat-factory', { baseUrl: 'http://localhost:8787', serviceId: 'blk_1' })
    await repos.integrationConfigs.put(first)
    assert.deepStrictEqual(await repos.integrationConfigs.get('cat-factory'), first)
    // A replacement drops a field the new value leaves out, rather than merging.
    const second = config('cat-factory', { baseUrl: 'https://cf.example.com' }, 2_000)
    await repos.integrationConfigs.put(second)
    assert.deepStrictEqual(await repos.integrationConfigs.get('cat-factory'), second)
  }),

  conformanceCase('integration settings that are not there read as null', async (repos) => {
    assert.strictEqual(await repos.integrationConfigs.get('cat-factory'), null)
  }),

  conformanceCase('deleting integration settings leaves the others', async (repos) => {
    await repos.integrationConfigs.put(config('cat-factory', { baseUrl: 'http://a' }))
    await repos.integrationConfigs.put(config('slack', { channelId: 'C1' }))
    await repos.integrationConfigs.delete('cat-factory')
    assert.strictEqual(await repos.integrationConfigs.get('cat-factory'), null)
    assert.deepStrictEqual(
      await repos.integrationConfigs.get('slack'),
      config('slack', { channelId: 'C1' }),
    )
  }),
]

export const integrationConfigTenancyCases: readonly TenancyCase[] = [
  tenancyCase('integration settings belong to one org', async (stores) => {
    await stores.forOrg('org-a').integrationConfigs.put(config('cat-factory', { serviceId: 'a' }))
    await stores.forOrg('org-b').integrationConfigs.put(config('cat-factory', { serviceId: 'b' }))
    await stores.forOrg('org-a').integrationConfigs.delete('cat-factory')
    assert.strictEqual(await stores.forOrg('org-a').integrationConfigs.get('cat-factory'), null)
    assert.deepStrictEqual(
      (await stores.forOrg('org-b').integrationConfigs.get('cat-factory'))?.values,
      { serviceId: 'b' },
    )
  }),
]
