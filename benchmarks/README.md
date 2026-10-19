# Developer benchmarks

These tools are maintained for manual performance investigations and are not
included in the published engine. Build/dev benchmarks prepare `examples/vault`
and measure its consumer-owned `.twiki/site` runtime. Set `TWIKI_PROJECT_ROOT` to
benchmark another configured vault. Preparation is outside the timed portion;
logs and timing JSON stay in that vault's `.twiki/site/build/benchmarks`. Live
probes must run from a prepared consumer runtime.

```sh
bun benchmarks/benchmark.ts build comparison
BENCHMARK_STATIC=true bun benchmarks/benchmark.ts build static-comparison
bun benchmarks/benchmark.ts dev startup
```

`live-test.ts` contains historical public-response, authentication, and rollback
probes. Run only the mode needed for an explicitly configured test deployment.
