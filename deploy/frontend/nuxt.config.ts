// The deployment app: it extends the @sainte-beuve/app layer and adds nothing but
// its own configuration. Copy this package to deploy the SPA on your own account.
export default defineNuxtConfig({
  extends: ['@sainte-beuve/app'],

  // Where this deployment's backend lives. Override at build time with
  // NUXT_PUBLIC_API_BASE; `ssr: false` means it is baked into the bundle.
  runtimeConfig: {
    public: {
      apiBase: 'http://localhost:8788',
    },
  },
})
