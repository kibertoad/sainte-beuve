import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, withContentSecurityPolicy } from '../build/csp'

// The policy a generated page carries. What matters is that it lets the app's
// own inline scripts run and nothing else inline: a hash per script, never
// `'unsafe-inline'`, so a `javascript:` URL rendered into a link is refused.

const BOOT = 'window.__NUXT__={}'
const PAGE =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<script type="importmap">{"imports":{}}</script>' +
  '<script type="module" src="/_nuxt/entry.js"></script>' +
  `</head><body><script>${BOOT}</script>` +
  '<script type="application/json" id="__NUXT_DATA__">[1]</script></body></html>'

function hashOf(body: string): string {
  return `'sha256-${createHash('sha256').update(body).digest('base64')}'`
}

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy(PAGE, { apiOrigin: 'https://api.example.com' })
  const scriptSrc = policy.split('; ').find((part) => part.startsWith('script-src')) ?? ''

  it('allows each executed inline script by its hash, and nothing inline besides', () => {
    expect(scriptSrc).toContain(hashOf(BOOT))
    expect(scriptSrc).toContain(hashOf('{"imports":{}}'))
    expect(scriptSrc).not.toContain('unsafe-inline')
    // A data block is not run, so it is not a script to allow.
    expect(scriptSrc).not.toContain(hashOf('[1]'))
  })

  it('lets the SPA reach its API and nowhere it did not name', () => {
    expect(policy).toContain("connect-src 'self' https://api.example.com")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'none'")
  })
})

describe('withContentSecurityPolicy', () => {
  it('puts the policy first in the head, before any script it governs', () => {
    const html = withContentSecurityPolicy(PAGE, { apiOrigin: null })
    const meta = html.indexOf('http-equiv="Content-Security-Policy"')
    expect(meta).toBeGreaterThan(html.indexOf('<head>'))
    expect(meta).toBeLessThan(html.indexOf('<script'))
  })

  it('leaves the charset declaration ahead of it, in the bytes a browser sniffs', () => {
    const html = withContentSecurityPolicy(PAGE, { apiOrigin: null })
    expect(html.indexOf('<meta charset="utf-8">')).toBeLessThan(
      html.indexOf('http-equiv="Content-Security-Policy"'),
    )
  })
})

describe('inline script detection', () => {
  it('reads the type attribute itself, not a data attribute that ends in one', () => {
    const body = 'window.colourMode=1'
    const page = `<html><head><SCRIPT data-type="application/json">${body}</SCRIPT></head></html>`
    expect(contentSecurityPolicy(page, { apiOrigin: null })).toContain(hashOf(body))
  })
})
