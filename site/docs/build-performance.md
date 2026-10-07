# Build performance experiments

Local build and startup performance improved, but **sub-30-second Cloudflare
deployment remains unachieved and unverified**. Changes are isolated on
`perf/build-performance`; no remote deployment was performed. Serial remains
the production default. Parallel builds are available as an explicit mode.

## Matched edition-build comparison

Five accepted trials use committed source `9faa529`, which includes main
`8637192`, the same 1,652-page corpus, actual Node 25.9.0/Bun 1.4.0,
R 4.5.0/knitr 1.50/car 3.1-3, and verified font/runtime identities. The baseline
is the current optimized native serial build, not the original implementation.

| Mode            | Available CPUs | Complete wall time |
| --------------- | -------------: | -----------------: |
| Native serial   |             48 |             63.78s |
| Isolated serial |             48 |             75.16s |
| Parallel        |             48 |             55.28s |
| Native serial   |              4 |             65.06s |
| Parallel        |              4 |             57.67s |

Parallel reduced wall time by **13.3% unrestricted** and **11.4% under four-CPU
affinity**. Isolated serial took 11.38s longer than native serial, exposing the
cost of isolation. Each row is one local measurement on a Threadripper 9960X;
there is no confidence interval or CI prediction. A later real parallel
validation build took 62.18s after publication fixtures reset its output,
showing that the 55.28s point is not a guaranteed build duration.

Every accepted trial starts with fresh generated/SvelteKit/static/course-catalog
output and cleared project Vite caches. Each receives the same selected-current
compiler seed: 21,561 files and 649,969,154 uncompressed bytes. Common reset and
canonical seed restoration are untimed for all modes. Mandatory isolated
source/dependency snapshots and copying the seed into both workspaces remain
inside the measured command. All editions regenerate 28 catalogs, hit all
1,652 parsed pages and 1,653 social cards, and log no new worksheet knitting or R
fallback. Ten prepared worksheet previews and their blobs are validated
separately; cache hits per worksheet are not explicitly logged.

The unrestricted parallel build includes 4.08s setup, 47.63s child span, 0.09s
invariant validation, 2.03s cache merge, 0.34s assembly and 1.07s cleanup.
Public/full children take 19.82s/47.63s and overlap; summing their durations
would overstate wall time. Four-CPU parallel includes the same required phases
and a 50.16s child span. Native serial has no isolated phase breakdown; complete
external command duration remains the comparison metric.
[Parallel results](../benchmarks/parallel-results.json) record every point,
source/runtime/seed digests, affinity, stage counts and timing scope.

Four-CPU trials use allowed IDs 0–3. Affinity constrains this workstation's
scheduling; it does not reproduce CI CPU speed, memory, disk, network, runner
provisioning, remote cache transport or Wrangler uploads. The build itself
still exceeds 30 seconds.

## Isolation and output acceptance

Each edition owns writable generated/static/source catalogs, dependency caches,
and build directories while reading one fixed content repository and maintained
source snapshot. This prevents races in navigation, file catalogs, page metadata,
compiler manifests, SvelteKit and Wrangler state. After both builds succeed,
assembly derives the public allowlist from public output, places that adapter
tree under the authenticated tree's `_published`, and promotes the complete
output with rollback on rename failure. Source/content invariant checks reject
mixed snapshots. Child failures terminate and await siblings, remove only
owned scratch directories, and preserve the previous completed output.
Use one writer for canonical generated output; run a concurrent dev server in
another worktree. Separate `build:all` invocations do not share a lock.

Parser, social-card and history selection limits accumulated generations;
complete R render records are conservatively retained. Portable history
manifests preserve history hits in fresh roots. Isolated cache
reconciliation preserves edition manifests and full private history; native
serial retains its historical local generations. Canonical application/static
inventories and production environment preserve application versions between
native and isolated roots. [Bun dotenv inputs](https://bun.sh/docs/runtime/environment-variables)
participate in versioning. Tailwind explicitly excludes documentation, tests,
and benchmark reports using its documented
[class source controls](https://tailwindcss.com/docs/detecting-classes-in-source-files).

[Strict parity](../benchmarks/parallel-parity.json) passes native versus isolated,
native versus parallel, isolated versus parallel, and native versus four-CPU
parallel. Each output has 1,652 compiled pages, 64,811 static files, 616 immutable
assets and ten R previews. PageDoc bytes, application catalogs, public routes,
source assets, preview references, immutable assets and all non-Pagefind assets
match exactly. Allowlist differences are confined to Pagefind aliases. Six
Pagefind files are added, six removed and two changed; content-manifest
`generatedAt` also differs. This is explicit exception handling, not zero churn
or measured remote upload savings.

Earlier 66.39s/78.72s trials failed immutable parity because Tailwind discovered
a class name in documentation. They use different source/app versions and are
excluded from the accepted table. Removing an inherited temporary font override
also fixed zero-width browser text and unreadable R plot labels. Accepted
trials use verified fonts and regenerated preview keys, with no raw font
configuration paths recorded.

CI preinstalls `car` with R/knitr. Unqualified worksheet package setup reuses
installed packages and rejects missing requests rather than downloading while
building. Renderer cache identity includes installed package/build inventory,
resolved font metadata/bytes and active font configuration. Unverified font
probes force cache misses while rendering continues. Parser policy is separated
from renderer identity so changing renderer dependencies does not invalidate
all parsed notes. The first remote benchmark observed 35s combined R/knitr/car
provisioning; the incremental cost of car alone remains unmeasured.

## Validation and development

Final validation and development use committed source `91bbf34`, which includes
main `0c142e3`, and an updated **1,654-page corpus with ten R worksheets**. This
is separate from the accepted five-trial build/parity pin `9faa529` and its
1,652 pages. The newer real parallel validation build passed in 55.79s with
retained canonical output; it is not another matched fresh-output timing point.
[Validation evidence](../benchmarks/parallel-validation.json) records both pins.

Main's later `1910cfb` R-provisioning fix is also merged. Its application and
build source matches `91bbf34`; the new real-R regressions passed 18 tests and
82 assertions. The required complete build after this synchronization passed
in 55.62s. These additional checks preserve the recorded measurement pins.

Main `a919c51` is also merged, including its published STAT 324 pointer. Its
1,655-page corpus passed the required complete parallel build in 80.70s. Both
editions reused 1,651 parsed pages and parsed four; each rendered three cards.
The course-wide worksheet inputs changed, so all ten R previews regenerated
without fallback. This synchronization build is not a matched performance trial.

Local development was rechecked at `0b91a49` with the same current-main corpus:

| Startup     | Vite ready | Expected homepage served |
| ----------- | ---------: | -----------------------: |
| After build |     23.38s |                   28.70s |
| Warm 1      |      2.53s |                    8.53s |
| Warm 2      |      2.50s |                    8.16s |

The first start reused all 1,655 parsed pages and ten R previews. Both warm
starts reused the saved snapshot without running the content pipeline. Fonts
were verified and every owned server/port was stopped. These are local
Threadripper measurements, separate from the GitHub CI runner.
[Current-main development evidence](../benchmarks/parallel-dev-main-sync-results.json)
preserves the exact source, runtime and measurement conditions.

The current unit run passed 238 tests/2,416 assertions across 51 files in 17.62s.
Svelte reported zero errors/warnings and Worker TypeScript passed. Link checks
covered 1,667 Markdown/Rmd files and 15,729 local targets with zero errors.
The pinned local Lychee binary was initially absent after output resets;
restoring version 0.24.2 and rerunning targets separately passed. Diagram checks
covered 1,657 notes, 67,238 math expressions and 248 Mermaid diagrams with zero
errors, using normal fonts.

The latest real-site E2E suite passed 68 tests, skipped ten and failed one:
a navigation toggle did not update `aria-expanded` after clicking. Its focused
unchanged-output recheck passed; no source fix or retry-setting change was made.
**The latest full suite is not a clean 69-test pass.** The earlier frozen
`9faa529` real-site full suite passed 69 with ten skipped and zero failures.
Parallel publication subsequently passed all ten browser tests across three
fixture builds (eight public, one files-only, one revoked), after an initial
private-tooltip timeout and a passing unchanged-fixture focused recheck.

Wrangler 4.100.0 `deploy --dry-run` passed locally, reading 70,133 asset files
and reporting an 8,932.41 KiB Worker (1,644.28 KiB gzip). No deployment occurred.
These scanner counts have a different scope from the 64,811-file static parity
inventory; they are not direct Cloudflare transfer-size equality evidence.

The development watcher now revalidates Git-only events against semantic
inputs and reuses saved output when an unrelated ref or unchanged index moves.
This avoids two unnecessary pipelines observed after another worktree updated
main's ref, while content/index changes still rebuild. The 41.56s integration
passed nested-registration, offline-edit, missing-output, recovery, privacy and
history cases; a browser edit took 824ms and fixture warm validation took 40ms.
Ordinary untracked notes intentionally remain undiscovered until indexed.
No untracked-cache-policy or `dev-state` change was needed.

| Current development measurement             | Vite ready | Expected HTML 200 |
| ------------------------------------------- | ---------: | ----------------: |
| First start after parallel production build |     23.65s |            29.22s |
| Warm restart 1                              |      2.61s |             8.79s |
| Warm restart 2                              |      2.62s |             8.67s |

Both warm starts reused their snapshot with zero content pipelines. These are
local current-source measurements with verified fonts and actual Node/Bun/R
versions; the servers were stopped after each run.
[Development results](../benchmarks/parallel-dev-results.json) retain the exact
conditions. First-start readiness and serving the first valid page are distinct.

## Earlier optimization evidence

The earlier speedup came from indexed link resolution, direct icon imports,
separate runtime navigation/icon data, stable application versions, selective
compiler caching, and moving public output during assembly. Deferred renderer
and history imports plus Cloudflare emulator prewarming reduced development
startup work. The parallel comparison measures an additional change on top of
those optimizations.

An earlier R-enabled fresh-output comparison used the same complete 1,647-page
corpus for original and optimized source, actual Node/Bun versions and R/knitr.
Original took 95.36s; optimized took 61.70s, a **35.3% improvement**, with fresh
catalog/static/SvelteKit output and encrypted warm compiler data. All 28 catalogs
rebuilt, all parser/social entries hit, eight preview outputs were present, and
no R knitting/fallback was logged. There was one point per revision.
[Fresh-output results](../benchmarks/fresh-output-results.json) retain its exact
conditions. This older corpus/source comparison is distinct from the current
native-versus-parallel table.

[Earlier warm results](../benchmarks/complete-results.json) include the matched
R-absent 94.44s original versus 63.25–65.81s optimized pair and earlier dev
startups. [Page parity](../benchmarks/page-parity.json),
[asset stability](../benchmarks/asset-stability.json), and
[algorithm microbenchmarks](../benchmarks/resolve-micro.json) preserve detailed
acceptance and stated Shiki/Pagefind exceptions. The initial 1,625-page worktree
fixture omitted nested assignment registration; its timings are provisional
same-fixture exploration, not complete-corpus acceptance.

Selecting current parser/social/history entries while retaining complete R
records reduced structural gzip-6 output from 316.4 to 155.7 MiB
and archive time from 10.97s to 5.41s. Gzip-1 saved 1.8s but added 7.8% bytes, so
level 6 remains. An older complete R-enabled snapshot saved 21,114 selected
entries as a 162.92 MiB authenticated encrypted archive in 6.79s. These are
[local cache measurements](../benchmarks/cache-transport.json), excluding remote
transport and predating the latest content/renderer identity. The original
1.79 GB accumulated-history archive is not a fair current-entry comparison.
Cache persistence now follows deployment and tolerates optional-save failures,
removing its previously observed 35–39s wait from time until the site is live.

A measured final-product cache proxy selected 107.5 MiB archived output in 6.51s
and extracted in 2.06s. Whole-edition caching is not implemented: safe reuse needs
adapter-derived inventories, complete fingerprints and current static reassembly.
Required binaries remain part of deployment; product presence alone cannot
verify publication policy.

## Observed optimized GitHub CI

[Run 37640282525, attempt 1](https://github.com/twangodev/wisconsin/actions/runs/37640282525)
successfully tested serial source `70d7433` on a four-CPU AMD EPYC 9V74 runner
with 16 GB RAM, Node 22.23.3, Bun 1.4.2, R 4.3.3, knitr 1.45 and car 3.1.2.
Font identity verification passed. Only the performance job ran; checks,
browser tests and deployment were skipped.

| Measurement | Complete build wall time | Cache/output conditions                                |
| ----------- | -----------------------: | ------------------------------------------------------ |
| `ci-first`  |                  587.59s | Fresh output; new compiler fingerprints needed priming |
| `ci-warm`   |                  176.27s | Same runner, retained compiler cache and output        |

The first public edition parsed all 1,654 pages and rendered all 1,655 cards;
the following full edition hit those caches and knitted ten worksheets. The
retained-output build hit every page/card cache, knitted no worksheets, logged
no R fallback, and reused 27 of 28 catalogs per edition. It does not represent
a fresh deployment runner or establish a CI parallel speedup.

Checkout took 40s, compiler decrypt/extract 22s, R provisioning 35s and locked
installation 4s. The restored encrypted archive was 548,606,419 bytes; the
selected-current archive saved afterward was 181,638,593 bytes and 21,975 files.
Encryption took 14s and remote cache save 3s. These are observed steps with
one-second timestamp resolution, not matched archive-size performance trials.
The complete benchmark job took 904s and includes both builds and setup.
[Sanitized remote evidence](../benchmarks/github-ci-results.json) preserves
the exact source, runtime, stage counts, cache keys and timing scopes.

Subsequent dispatches and a rerun returned HTTP 500, so a branch-scoped push
fallback completed [run 37643009989](https://github.com/twangodev/wisconsin/actions/runs/37643009989)
at `0b91a49`, including main `a919c51` and its 1,655-page corpus. All three
benchmark jobs passed; no deployment job ran.

| Mode     | Fresh-runner output | Retained canonical output | Runner CPU model |
| -------- | ------------------: | ------------------------: | ---------------- |
| Serial   |             165.83s |                   178.42s | AMD EPYC 7763    |
| Parallel |             175.33s |                   212.24s | AMD EPYC 9V74    |

Both measured jobs had four CPUs, about 16 GB RAM and matching software
versions. Every edition hit all 1,655 parsed pages and 1,656 social cards,
knitted no worksheets and logged no R fallback. Both fresh-runner measurements
regenerated 28 catalogs. Native retained output reused 27 catalogs; isolated
parallel children always start with fresh output and regenerated all 28.

The first parallel command spent 16.46s on setup, 131.14s in overlapping child
builds, 0.21s validating invariants, 9.29s merging caches, 3.06s assembling output
and 15.15s cleaning up. Its retained-output repeat spent 28.19s on setup and
24.24s assembling output. These actual CI overheads are much larger than local
measurements. Child public/full durations were 57.48s/131.13s; they overlap.

Parallel did not beat serial in these observations, and the different CPU
models prevent a controlled speedup claim. The earlier priming job used a third
model, EPYC 9V45. Serial remains the production default. GitHub's live step
status lagged completed log timestamps; the benchmark JSON and final completed
metadata are the recorded timing authorities.

A follow-up places priming and both measurements on one runner. It captures
one private compiler seed, verifies its complete content digest and restores it
before each fresh-output measurement. Common seed capture/reset is untimed;
all required parallel setup, merging, assembly and cleanup remain timed. The
guarded reset preserves maintained files and rejects redirected paths or an
altered seed before deleting generated output. Eight temporary fixture checks
passed. Fixed serial-then-parallel order still leaves normal timing variation.
The required local complete build before this experiment passed in 57.57s,
with no new R knitting or fallback; helper TypeScript and workflow guards passed.
That controlled remote comparison is pending; optimized Cloudflare deployment
remains unmeasured.

## Historical production CI baseline

Five successful October 5–6, 2026 GitHub Actions runs observed a median 236s
public/full build and 445s complete deployment job. Wrangler took 69–130s;
the latest changed-asset upload alone took 45.18s. Median checkout was 32s,
compiler decrypt/extract 20s, R/knitr installation 17s and compiler encrypt/save
36s. These predate the optimized parallel implementation and car provisioning.
The latest parser/social caches were already warm, but all 28 catalogs and
34,248 full-edition assets regenerated. Fresh output, runtimes and R fidelity
contribute alongside hardware to the gap from local retained-output timings.

Runs: [37396634943](https://github.com/twangodev/wisconsin/actions/runs/37396634943),
[37358998002](https://github.com/twangodev/wisconsin/actions/runs/37358998002),
[37347350802](https://github.com/twangodev/wisconsin/actions/runs/37347350802),
[37255238239](https://github.com/twangodev/wisconsin/actions/runs/37255238239), and
[37252406647](https://github.com/twangodev/wisconsin/actions/runs/37252406647).
These production runs are not directly comparable to the benchmark-only job
above, which performs two builds and includes cold fingerprint priming.

## Reproduction

From `site/`, keep normal font settings and use locked dependencies:

```sh
WISCONSIN_BUILD_MODE=serial bun tooling/benchmark.ts build native-comparison
WISCONSIN_BUILD_MODE=isolated-serial bun tooling/benchmark.ts build isolated-comparison
WISCONSIN_BUILD_MODE=parallel bun tooling/benchmark.ts build parallel-comparison
bun tooling/benchmark.ts dev dev-comparison
```

For fair comparison, freeze the source/content/runtime pins, restore the same
portable compiler seed, reset the same generated/Vite outputs and run trials
serially. Ignored `build/benchmarks` holds timing JSON and private logs. Dev
records Vite readiness and the first HTTP 200 with expected home-page HTML and
terminates only its own process group. Local timeout is 300s; override
`BENCHMARK_TIMEOUT_SECONDS` when appropriate. Actual Node version is separate
from Bun's Node compatibility version.

The optional manual workflow runs benchmarks only, with production/check jobs
disabled. `build_mode` defaults to serial and affects only that job:

```sh
gh workflow run svelte.yml --ref perf/build-performance -f performance=true -f build_mode=parallel
```

The serial dispatch above was performed. It reuses production recursive checkout,
R/car setup and dependency/compiler restore, records actual runtimes/mode/font
verification, then measures `ci-first` fresh output and `ci-warm` retained output.
Cold/new compiler fingerprints can make the first slow; the second does not
model a fresh deployment runner. Each allows 1,200s within a 45-minute job.
Summary JSON is whitelisted; private body/logs/artifact paths are not uploaded.
Optional authenticated cache save follows both measurements and summary, with
normal branch-scoped access rules.

The temporary `Build performance` fallback runs only on pushes to
`perf/build-performance` that change `.github/workflows/build-performance.yml`.
It has no deployment job. Its first revision used separate priming, serial and
parallel jobs with distinct cache-save keys. The current controlled revision
uses one runner and one captured compiler seed, then resets generated output
before each explicitly selected mode. A private plaintext seed is removed at
the end; only the existing encrypted archive can be restored from Actions
cache. Summary data contains numeric timings, runtime/font identity and host
metadata. Actual cache hits still determine whether a comparison is accepted.

Runtime pinning remains a separate tested migration: local uses Node 25.9.0/Bun
1.4.0 while the historical latest CI used Bun 1.4.2 and unknown Node. The workflow
now records actual runtimes. Retain
[frozen-lockfile installs](https://bun.com/docs/pm/cli/install), complete Git
history, R fidelity, cold/miss-safe caches and encryption because
[base-branch caches can be read by fork PRs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
[Cloudflare already deduplicates unchanged assets](https://developers.cloudflare.com/workers/static-assets/direct-upload/).
Direct remote measurements remain necessary to assess the deployment target.
