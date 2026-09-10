import { GITHUB_APP_SETUP_PATH, GITHUB_SIGN_IN_CALLBACK_PATH } from '@sainte-beuve/contracts'
import { ValidationError } from '@sainte-beuve/kernel'
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { ConnectionsService } from './ConnectionsService.js'

/**
 * Where GitHub sends the BROWSER back to.
 *
 * Outside `/api/v1` with the webhooks, and for the same reason: these URLs are
 * typed into a GitHub App's settings by hand, so they have to survive an API
 * version bump. They are also the only routes in the tree whose caller is a
 * navigation rather than a client, which is what decides their shape: a 302 back
 * to the SPA when the deployment says where that is, and a plain page when it
 * does not, because a JSON body is not an answer to somebody staring at a
 * browser tab.
 */
export function connectController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get(GITHUB_SIGN_IN_CALLBACK_PATH, async (c) => {
    const code = c.req.query('code')
    if (code === undefined) {
      // GitHub sends the operator here with `error=access_denied` when they
      // decline, which is a decision rather than a fault; it still has to say so.
      throw new ValidationError(
        `GitHub returned no authorization code (${c.req.query('error') ?? 'no reason given'}). ` +
          'Start the sign-in again from the Configuration screen.',
      )
    }
    const { login, returnTo } = await new ConnectionsService(c.get('container')).completeSignIn({
      code,
      state: c.req.query('state') ?? null,
      origin: new URL(c.req.url).origin,
    })
    return finish(c, returnTo, `Connected to GitHub as ${login}.`)
  })

  app.get(GITHUB_APP_SETUP_PATH, async (c) => {
    const { returnTo } = await new ConnectionsService(c.get('container')).completeAppInstall(
      c.req.query('state') ?? null,
    )
    // Nothing is stored: an installation is resolved from the repository it is
    // used for, so the App is usable the moment GitHub says it is installed.
    return finish(c, returnTo, 'The GitHub App is installed. This deployment can now use it.')
  })

  return app
}

/**
 * Back to the SPA, or a page saying what happened. The status is carried in the
 * query rather than a fragment because the SPA reads it on load and there is no
 * credential in it: what is sensitive already went into the token store.
 */
function finish(c: Context<AppEnv>, returnTo: string | null, message: string): Response {
  if (returnTo === null) return c.text(message, 200)
  const url = new URL(returnTo)
  url.searchParams.set('connected', 'github')
  return c.redirect(url.toString(), 302)
}
