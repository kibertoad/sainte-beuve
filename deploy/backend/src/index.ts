// Backend deployment entry point.
//
// This is the example DEPLOYMENT of the reusable @sainte-beuve/worker library. It
// contains no logic of its own: it re-exports the library's fetch/scheduled
// handler, which wrangler bundles and resolves from the installed package.
//
// To run your own deployment you need this re-export, wrangler.toml, and your
// secrets. Swap the workspace dependency in package.json for the published
// version, e.g. "@sainte-beuve/worker": "^0.1.0".
export { default } from '@sainte-beuve/worker'
