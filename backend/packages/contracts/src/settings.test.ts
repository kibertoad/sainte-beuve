import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { integrationTokenStatusSchema, setIntegrationTokenSchema } from './settings.js'

describe('setIntegrationTokenSchema', () => {
  it('trims a pasted token rather than sealing the whitespace with it', () => {
    expect(v.parse(setIntegrationTokenSchema, { token: '  cf_live_abcd1234  ' }).token).toBe(
      'cf_live_abcd1234',
    )
  })

  it('refuses a value too short to be a token', () => {
    expect(() => v.parse(setIntegrationTokenSchema, { token: 'oops' })).toThrow()
  })
})

describe('integrationTokenStatusSchema', () => {
  it('carries no field a token could be read back out of', () => {
    expect(Object.keys(integrationTokenStatusSchema.entries)).toStrictEqual([
      'integrationId',
      'state',
      'unreadableReason',
      'inUse',
      'hint',
      // `subject` names the ACCOUNT a credential belongs to, which is a fact a
      // screen needs and the credential itself is not.
      'subject',
      'updatedAt',
    ])
  })

  it('refuses an integration the deployment does not know', () => {
    expect(() =>
      v.parse(integrationTokenStatusSchema, {
        integrationId: 'nope',
        state: 'absent',
        unreadableReason: null,
        inUse: false,
        hint: null,
        subject: null,
        updatedAt: null,
      }),
    ).toThrow()
  })
})
