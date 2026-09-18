import { describe, expect, it } from 'vitest'
import { authModeFrom } from '../src/config/authMode.js'

// One reading of AUTH_MODE for all three runtimes. The cases below are the two
// the security review found on the wrong side of the line: a typo used to mean
// `open`, and `open` used to be legal on a public host, where it means every
// reachable client is an admin of the default org.

const LOCAL = { value: undefined, appBaseUrl: null, corsOrigins: ['*'] }

describe('authModeFrom', () => {
  it('leaves a laptop open, which is what every facade ships', () => {
    expect(authModeFrom(LOCAL)).toBe('open')
    expect(authModeFrom({ ...LOCAL, value: 'open' })).toBe('open')
    expect(authModeFrom({ ...LOCAL, value: '' })).toBe('open')
  })

  it('reads the mode case-insensitively and past the spaces a copied file keeps', () => {
    expect(authModeFrom({ ...LOCAL, value: ' Required ' })).toBe('required')
  })

  it('refuses a value it does not recognise rather than falling back to open', () => {
    // The two directions are not symmetric: `requried` used to be a public
    // admin, and a refusal is a typo somebody fixes in a minute.
    expect(() => authModeFrom({ ...LOCAL, value: 'requried' })).toThrow(/AUTH_MODE/)
    expect(() => authModeFrom({ ...LOCAL, value: 'none' })).toThrow(/AUTH_MODE/)
  })

  it('refuses open on a deployment that named a public SPA', () => {
    expect(() =>
      authModeFrom({ value: 'open', appBaseUrl: 'https://sb.example.com', corsOrigins: ['*'] }),
    ).toThrow(/sb\.example\.com/)
  })

  it('refuses open beside a public CORS origin', () => {
    expect(() =>
      authModeFrom({ value: 'open', appBaseUrl: null, corsOrigins: ['https://sb.example.com'] }),
    ).toThrow(/AUTH_MODE=required/)
  })

  it('allows open where every named origin is this machine', () => {
    expect(
      authModeFrom({
        value: 'open',
        appBaseUrl: 'http://localhost:3000',
        corsOrigins: ['*', 'http://127.0.0.1:3000', 'http://[::1]:3000'],
      }),
    ).toBe('open')
  })

  it('allows required wherever it is set, which is the point of setting it', () => {
    expect(
      authModeFrom({
        value: 'required',
        appBaseUrl: 'https://sb.example.com',
        corsOrigins: ['https://sb.example.com'],
      }),
    ).toBe('required')
  })

  it('ignores a CORS entry that is not an origin, because nothing else reads one either', () => {
    expect(authModeFrom({ value: 'open', appBaseUrl: null, corsOrigins: ['not an origin'] })).toBe(
      'open',
    )
  })
})
