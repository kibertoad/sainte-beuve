import type { RequestScope } from '@sainte-beuve/server'
import { describe, expect, it } from 'vitest'
import { clientAddressHeaderFrom, clientAddressOf } from './clientAddress.js'

function scope(headers: Record<string, string>, peer = '10.0.0.2'): RequestScope {
  return {
    req: new Request('http://localhost/api/v1/reviews', { headers }),
    env: { incoming: { socket: { remoteAddress: peer } } },
    waitUntil: () => undefined,
  }
}

describe('clientAddressOf', () => {
  it('is the socket peer when no proxy header is configured', () => {
    const of = clientAddressOf(null)
    expect(of(scope({ 'x-forwarded-for': '203.0.113.7' }))).toBe('10.0.0.2')
  })

  it('is the entry the proxy appended, not one the client wrote', () => {
    const of = clientAddressOf('x-forwarded-for')
    expect(of(scope({ 'x-forwarded-for': '198.51.100.1, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('is the socket peer for a request that did not come through the proxy', () => {
    expect(clientAddressOf('x-real-ip')(scope({}))).toBe('10.0.0.2')
  })
})

describe('clientAddressHeaderFrom', () => {
  it('reads blank as none and a name in lower case', () => {
    expect(clientAddressHeaderFrom(undefined)).toBeNull()
    expect(clientAddressHeaderFrom(' ')).toBeNull()
    expect(clientAddressHeaderFrom('X-Real-IP')).toBe('x-real-ip')
  })

  it('refuses a value that is not a header name, naming the variable', () => {
    expect(() => clientAddressHeaderFrom('x-forwarded-for: 1.2.3.4')).toThrow(
      /CLIENT_ADDRESS_HEADER/,
    )
  })
})
