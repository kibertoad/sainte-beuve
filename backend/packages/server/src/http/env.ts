import type { AppContainer } from '../container.js'
import type { RequestPrincipal } from '../modules/auth/principal.js'

/**
 * The Hono env every controller is typed against: the container, and who is
 * calling.
 *
 * `principal` is set by the authentication middleware and is therefore absent on
 * the routes that sit outside `/api/v1` — the webhooks and the connect
 * callbacks, which are authenticated by their own signatures rather than by a
 * caller. `principalOf` reads it with that in mind.
 */
export type AppEnv = {
  Variables: {
    container: AppContainer
    principal: RequestPrincipal
  }
}
