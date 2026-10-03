import { createHash } from 'node:crypto'

/**
 * The Content-Security-Policy every generated page carries, written into the
 * page itself.
 *
 * In the HTML rather than in a header, because the SPA is a static bucket and a
 * bucket's headers are whatever its host's configuration file says — Pages'
 * `_headers`, an S3 bucket's metadata, an nginx block — while the page is the
 * same file everywhere. A `<meta>` policy cannot carry `frame-ancestors`, so
 * that one stays with the host (see deploy/frontend/public/_headers).
 *
 * What it is FOR is the inline scripts. Nuxt writes three into every page (the
 * import map, the colour-mode bootstrap and the runtime config), so the honest
 * `script-src 'self'` would refuse the app itself, and `'unsafe-inline'` would
 * allow exactly what this exists to refuse: a `javascript:` URL in a link the
 * SPA renders from somebody else's input. Each inline script is allowed by its
 * own hash instead, computed from the page as it was generated, and anything
 * else inline is refused.
 *
 * Styles keep `'unsafe-inline'`: Vue binds `style` attributes and Nuxt UI
 * injects its colour variables at runtime, and a style cannot run anything.
 */
export interface PolicyInput {
  /** Where the API is, which every screen calls and the attention stream opens. */
  apiOrigin: string | null
}

/**
 * Where icons come from at runtime. The SPA has no server to bundle them on, so
 * `@nuxt/icon` fetches each set from Iconify's API, falling back in this order.
 */
const ICON_ORIGINS = [
  'https://api.iconify.design',
  'https://api.simplesvg.com',
  'https://api.unisvg.com',
]

/** Script types a browser executes, and so the ones `script-src` governs. */
const EXECUTED = new Set(['', 'module', 'text/javascript', 'application/javascript', 'importmap'])

const INLINE_SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi

/** The `type` of a script tag's attributes, lower-cased, or '' when it has none. */
function typeOf(attributes: string): string {
  // `(?:^|\s)` rather than `\b`, which would read `data-type=` as the type.
  const match = /(?:^|\s)type\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)
  return (match?.[1] ?? '').toLowerCase()
}

/** The hash source of every inline script on the page a browser would run. */
function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>()
  for (const [, attributes = '', body = ''] of html.matchAll(INLINE_SCRIPT)) {
    if (/\bsrc\s*=/i.test(attributes)) continue
    if (!EXECUTED.has(typeOf(attributes))) continue
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }
  return [...hashes]
}

export function contentSecurityPolicy(html: string, input: PolicyInput): string {
  const api = input.apiOrigin === null ? [] : [input.apiOrigin]
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inlineScriptHashes(html)].join(' '),
    "style-src 'self' 'unsafe-inline'",
    // Avatars are whatever URL a host handed back for an account.
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    ["connect-src 'self'", ...api, ...ICON_ORIGINS].join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
}

const HEAD = /<head(\s[^>]*)?>/i
const CHARSET = /<meta\s[^>]*\bcharset\s*=[^>]*>/i
const FIRST_SCRIPT = /<script[\s>]/i

/**
 * The page with its policy in place, ahead of every script, because a `<meta>`
 * policy governs only what the parser meets after it: right after the charset
 * declaration when that comes first, and otherwise first in `<head>`. Not ahead
 * of the charset, which a browser looks for in the first 1024 bytes only, and a
 * policy with a hash per script is a fair share of those.
 */
export function withContentSecurityPolicy(html: string, input: PolicyInput): string {
  const policy = contentSecurityPolicy(html, input).replaceAll('"', '&quot;')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  const charset = CHARSET.exec(html)
  const firstScript = html.search(FIRST_SCRIPT)
  if (charset !== null && (firstScript === -1 || charset.index < firstScript)) {
    const end = charset.index + charset[0].length
    return `${html.slice(0, end)}${meta}${html.slice(end)}`
  }
  return html.replace(HEAD, (head) => `${head}${meta}`)
}
