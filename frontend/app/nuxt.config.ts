import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// This is a Nuxt LAYER: a consuming app `extends` it (see deploy/frontend). Config
// file paths must resolve against THIS layer's directory, not the consumer's:
// `~`/`@` rebind to the consumer's srcDir, so an asset referenced as
// `~/assets/...` would be looked up in the consumer and silently missing. Use an
// absolute path anchored here instead.
const layerDir = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2025-06-01',
  devtools: { enabled: true },

  // A pure client-side SPA against the sainte-beuve API. No SSR: there is nothing
  // to render before the viewer is known, and it keeps the deployment target a
  // static bucket rather than a server.
  ssr: false,

  modules: ['@nuxt/ui'],

  css: [join(layerDir, 'app/assets/css/main.css')],

  runtimeConfig: {
    public: {
      // Base URL of the sainte-beuve API. Defaults to the local Node/local-mode
      // server; override per environment with NUXT_PUBLIC_API_BASE. Baked in at
      // build time, because `ssr: false`.
      apiBase: 'http://localhost:8788',
    },
  },
})
