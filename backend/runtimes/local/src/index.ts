import { randomBytes } from 'node:crypto'
import { type NodeConfig, type RunningServer, loadConfig, start } from '@sainte-beuve/node-server'

/**
 * LOCAL MODE: the whole product on a developer's machine, with nothing registered
 * anywhere.
 *
 * This is not a stripped-down build. It is the same app, the same routes and the
 * same reminder clock the Node facade serves, and every credential path a hosted
 * deployment has (a GitHub App, a sign-in, a pasted token) is configurable here
 * too. What local mode changes is the DEFAULTS, so that running it requires no
 * Slack workspace, no GitHub App and no cat-factory account:
 *
 *   - CORS opens to `*`, because the SPA is on a different localhost port.
 *   - cat-factory defaults to `http://localhost:8787`, which is where a local
 *     cat-factory serves. Point `CAT_FACTORY_BASE_URL` at the centralized instance
 *     to use that one instead; the rest of the wiring is identical either way.
 *   - The reminder clock still runs, just faster, so a developer can watch a nudge
 *     fire in a minute rather than in four hours.
 *   - The store is in memory, so a restart empties the board and nothing has to
 *     be installed to try the product. `DATABASE_URL` points local mode at a
 *     Postgres and it becomes durable, schema applied at boot, exactly as the
 *     Node deployment does it.
 *   - The credential-encryption key is generated at boot, so the Configuration
 *     screen works with nothing set. It is EPHEMERAL, and that is the honest
 *     default beside a store that empties on a restart: a token entered in the
 *     SPA does not outlive the process either way. Set SETTINGS_ENCRYPTION_KEY
 *     to pin it to the one a hosted deployment uses, which is also what a local
 *     run with a `DATABASE_URL` needs. A blank one in a copied `.env` counts as
 *     unset, not as a key.
 *   - CORS opens to `*` for the board; the configuration routes read that as
 *     loopback only, which is the local SPA and nothing else. See `allowedOrigin`
 *     in @sainte-beuve/server.
 *
 * Everything a hosted deployment configures is still configurable here, and nothing
 * is required. That is the property that matters: a local run exercises the same
 * code paths, so a bug found locally is a bug in production.
 */
export interface LocalOptions {
  /** Override the environment the config is read from. Handy in a test. */
  env?: Record<string, string | undefined>
}

const LOCAL_CAT_FACTORY_BASE_URL = 'http://localhost:8787'
const ENCRYPTION_KEY_BYTES = 32

export function localConfig(env: Record<string, string | undefined> = process.env): NodeConfig {
  return loadConfig({
    PORT: '8788',
    CORS_ORIGINS: '*',
    LOG_LEVEL: 'debug',
    // Fast enough to watch, slow enough not to spam a local Slack app.
    REMINDER_INTERVAL_MS: '15000',
    CAT_FACTORY_BASE_URL: LOCAL_CAT_FACTORY_BASE_URL,
    ...env,
    // AFTER the spread, and `||`: `.env.example` ships `SETTINGS_ENCRYPTION_KEY=`
    // for a developer to fill in, `--env-file` reads that blank line as `''`, and
    // a default placed BEFORE the spread would be overwritten by it. Copying the
    // example file would then turn the Configuration screen off, which is the
    // opposite of what local mode promises. A fresh key per boot, because
    // nothing sealed under it has to survive a restart: nothing in the default
    // store does either. A local run against a `DATABASE_URL` should set this,
    // or the credentials in that database are unreadable after a restart.
    SETTINGS_ENCRYPTION_KEY:
      env.SETTINGS_ENCRYPTION_KEY || randomBytes(ENCRYPTION_KEY_BYTES).toString('base64'),
  })
}

export async function startLocal(options: LocalOptions = {}): Promise<RunningServer> {
  // Delegated, not reimplemented: local mode IS the Node facade with different
  // defaults, so it must not carry its own copy of the serve/tick/shutdown path
  // for the two to drift apart in.
  return start(localConfig(options.env))
}
