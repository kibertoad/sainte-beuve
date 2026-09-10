import type { AppContainer } from '../container.js'

/** The Hono env every controller is typed against: the container, and nothing else. */
export type AppEnv = {
  Variables: {
    container: AppContainer
  }
}
