import type { AuthMode } from '@sainte-beuve/contracts'

/**
 * Which `AUTH_MODE` a deployment actually asked for.
 *
 * ONE reading of the variable for all three runtimes, which is the reason this
 * is a function and not four lines repeated in each facade. It replaces two
 * decisions the security review found on the wrong side of the line:
 *
 *  - An unrecognised value used to mean `open`. A variable nobody can spell must
 *    not be the difference between a closed deployment and an open one that
 *    believes it is closed, and the two failure directions are not symmetric:
 *    `AUTH_MODE=requried` was a public admin, and a refusal to boot is a typo
 *    somebody fixes in a minute.
 *  - `open` used to be legal anywhere. It is the right default for a laptop and
 *    it means, quite literally, that every reachable client is an ADMIN of the
 *    default org (see `roleOf`): it can replace the org's stored credentials,
 *    empty the registry and spend the cat-factory key. A deployment that has
 *    NAMED a public origin — through `APP_BASE_URL` or through `CORS_ORIGINS` —
 *    has said it is not a laptop, so that combination is refused rather than
 *    served.
 *
 * The wildcard is not a named origin: it is the absence of a statement, and it
 * is what every facade ships, so it leaves a local run alone.
 */
export interface AuthModeInput {
  /** The raw `AUTH_MODE`, exactly as the environment spelled it. */
  value: string | undefined
  /** Where the SPA is served from, when the deployment said. */
  appBaseUrl: string | null | undefined
  /** The origins this deployment answers, as the facade computed them. */
  corsOrigins: readonly string[]
}

const MODES = 'AUTH_MODE is `open` or `required`'

const PUBLIC_OPEN =
  'AUTH_MODE=open means this deployment refuses nobody, and an anonymous caller is an ADMIN of ' +
  'its default org: it can replace the stored GitHub, GitLab, Slack and cat-factory ' +
  'credentials, empty the project registry and spend the AI-review key. That is the right ' +
  'default for a laptop and it is not one for a deployment reachable at %s. ' +
  'Set AUTH_MODE=required, or drop the public origin.'

/**
 * Hostnames that are this machine. A deployment answering only these is the
 * laptop the open default exists for.
 */
function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

/** The first configured origin that is somewhere other than this machine. */
function publicOrigin(input: AuthModeInput): string | null {
  const named = [...input.corsOrigins, input.appBaseUrl ?? '']
  for (const entry of named) {
    if (entry.length === 0 || entry === '*') continue
    let hostname: string
    try {
      hostname = new URL(entry).hostname
    } catch {
      // Not an origin at all. `allowedOrigin` already ignores it, and refusing
      // to boot over a value nothing reads would be a worse answer than the
      // wildcard it degrades to.
      continue
    }
    if (!isLoopback(hostname)) return entry
  }
  return null
}

export function authModeFrom(input: AuthModeInput): AuthMode {
  const typed = (input.value ?? '').trim().toLowerCase()
  if (typed === 'required') return 'required'
  // UNSET is the documented default and stays `open`: an existing deployment and
  // local mode both run on the absence of the variable, and turning a missing
  // value into a boot failure would close a door nobody opened.
  if (typed !== '' && typed !== 'open') {
    throw new Error(`${MODES}, and this deployment was given "${input.value ?? ''}".`)
  }
  const reachable = publicOrigin(input)
  if (reachable !== null) throw new Error(PUBLIC_OPEN.replace('%s', reachable))
  return 'open'
}
