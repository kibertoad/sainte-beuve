import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// This is a Nuxt LAYER: a consuming app `extends` it (see deploy/frontend). Config
// file paths must resolve against THIS layer's directory, not the consumer's:
// `~`/`@` rebind to the consumer's srcDir, so an asset referenced as
// `~/assets/...` would be looked up in the consumer and silently missing. Use an
// absolute path anchored here instead.
const layerDir = dirname(fileURLToPath(import.meta.url))

/** Where the API is when nobody says otherwise: the local Node/local-mode server. */
const DEFAULT_API_BASE = 'http://localhost:8788'

/**
 * The API's ORIGIN at build time, for the preconnect hint below, and null when
 * this build cannot know it.
 *
 * Read from the environment rather than from `runtimeConfig`, because a static
 * head is written when the site is generated and a runtime config is not
 * readable then — and with `ssr: false` the config is baked at build anyway, so
 * the two agree by construction. A value that is not a URL yields null rather
 * than failing the build: a bad `NUXT_PUBLIC_API_BASE` is a deployment fault the
 * SPA reports at the first call, and a missing performance hint must not be the
 * thing that reports it.
 */
const API_ORIGIN = ((base: string) => {
  try {
    return new URL(base).origin
  } catch {
    return null
  }
})(process.env.NUXT_PUBLIC_API_BASE || DEFAULT_API_BASE)

export default defineNuxtConfig({
  compatibilityDate: '2025-06-01',
  devtools: { enabled: true },

  // A pure client-side SPA against the sainte-beuve API. No SSR: there is nothing
  // to render before the viewer is known, and it keeps the deployment target a
  // static bucket rather than a server.
  ssr: false,

  modules: ['@nuxt/ui'],

  css: [join(layerDir, 'app/assets/css/main.css')],

  app: {
    head: {
      // The API is usually on ANOTHER origin, and the first act of every screen
      // is to call it. In the generated HTML rather than in a composable,
      // because that is the whole point: the browser starts DNS, TCP and TLS to
      // the API while it is still downloading the bundle, instead of meeting all
      // three — plus a CORS preflight — in series at the first fetch.
      //
      // `use-credentials`, because every call this SPA makes sends the session
      // cookie (`credentials: 'include'`). An anonymous preconnect opens a
      // connection in a different pool from the one those requests use, so the
      // handshake would be paid twice and this hint would buy nothing.
      link:
        API_ORIGIN === null
          ? []
          : [{ rel: 'preconnect', href: API_ORIGIN, crossorigin: 'use-credentials' }],
    },
  },

  runtimeConfig: {
    public: {
      // Base URL of the sainte-beuve API. Defaults to the local Node/local-mode
      // server; override per environment with NUXT_PUBLIC_API_BASE. Baked in at
      // build time, because `ssr: false`.
      apiBase: DEFAULT_API_BASE,
    },
  },
})
