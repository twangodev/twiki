# GitHub cache integration

The adapter connects GitHub's cache service to Twiki's encrypted product-cache
tooling. Engine cache planning and verification remain in `site/tooling`.

Maintain `src/index.ts`, then regenerate the Node entry point:

```sh
bun run integrations:build
```

Commit `dist/index.js` alongside the source. `bun run check` checks its TypeScript
types; `bun run test` rejects stale generated JavaScript. Integration fixtures
exercise the generated entry point under Node, including consumer staging and
cache trust boundaries.

The npm export `@twango/twiki/actions/product-cache` continues to resolve to the
Node entry point. Consumers need Bun and the installed Twiki package, which
supplies `@actions/cache`. The action metadata uses `dist/index.js` under Node 24.
