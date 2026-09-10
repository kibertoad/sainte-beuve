/**
 * A worker that does nothing, because the suite tests the STORE rather than a
 * request path. The pool needs an entrypoint to build a bundle around, and the
 * cases reach the D1 binding through `env` instead of through a fetch.
 */
export default {
  fetch(): Response {
    return new Response('sainte-beuve persistence conformance', { status: 200 })
  },
}
