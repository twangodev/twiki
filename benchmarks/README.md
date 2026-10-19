# Developer benchmarks

These tools are maintained for manual performance investigations and are not
included in the published engine. Build/dev benchmarks operate on the engine's
`site/` directory. Live probes must run from a prepared consumer runtime.

```sh
bun benchmarks/benchmark.ts build comparison
bun benchmarks/benchmark.ts dev startup
```

`live-test.ts` contains historical public-response, authentication, and rollback
probes. Run only the mode needed for an explicitly configured test deployment.
