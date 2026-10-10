---
title: Builds and caching
---

# Builds and caching

Twiki stages engine code in `<vault>/.twiki/site`. Dependencies install from the shipped frozen lockfile into a separate runtime-owned `node_modules`, so unrelated vault dependencies cannot change the compiler.

Repeated preparation reuses that installation. Compiler, application, search, worksheet and Worker caches live in the consumer's generated state. Cache validity depends on the engine, configuration, renderer and relevant content inputs; changed notes should invalidate their dependents without forcing every unrelated note to render again.

Inspect resolved paths with `bunx twiki prepare --json`. Engine tooling can run through `bunx twiki exec -- <Bun arguments>`.

For CI, the engine exposes compiler-cache tooling:

```sh
bunx twiki prepare
bunx twiki exec -- tooling/cache.ts restore
bunx twiki build --target cloudflare
bunx twiki exec -- tooling/cache.ts save
```

Encrypted cache transport requires `BUILD_CACHE_KEY`; do not cache private compilation products in plaintext. A missing or invalid cache must recover through a normal build. Treat caches as an optimization, never the only copy of notes or a replacement for validation.

R worksheets require a local renderer and their declared packages. Rendering does not download missing packages. Their cache also depends on the renderer and font environment.

[[guides/ci|CI deployment]] explains artifact reuse, which avoids rebuilding a validated Worker during upload.
