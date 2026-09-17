import type { AppContainer } from '../container.js'
import type { RequestPrincipal } from '../modules/auth/principal.js'

/**
 * The Hono env every controller is typed against: the container, who is calling,
 * and the origins this deployment answers.
 *
 * `principal` is set by the authentication middleware and is therefore absent on
 * the routes that sit outside `/api/v1` — the webhooks and the connect
 * callbacks, which are authenticated by their own signatures rather than by a
 * caller. `principalOf` reads it with that in mind.
 *
 * `corsOrigins` is the list the facade computed for THIS request, put on the
 * context by `createApp` rather than read a second time from configuration: the
 * SameSite decision on the session cookie and the origin decision on the
 * response are the same fact about where this deployment's SPA lives, and a
 * second reading is how the two come to disagree. See `namesAnotherHost`.
 */
export type AppEnv = {
  Variables: {
    container: AppContainer
    principal: RequestPrincipal
    corsOrigins: readonly string[]
  }
}
