# Cached SSR builds

The performance branch also has an explicit manual production experiment:
dispatch `Svelte` with `performance=true` and `live_test=deploy`. This is
restricted to `perf/build-performance` and shares current main's deployment
concurrency group. It records the active Worker version, compares public HTML
responses on the same runner before and after deployment, and checks anonymous
private-note and internal-asset denial. It does not migrate the database or save
branch products into trusted production caches.

Failed upload or live acceptance automatically rolls back to the recorded
version and checks that version is active with working homepage HTML. An explicit
`live_test=rollback` dispatch accepts that recorded `rollback_version` without a
content build. The artifact contains only version IDs and public response timings.
First-request times include connection overhead and do not establish isolated
Worker cold-start latency. Acceptance rejects warm medians above the larger of
500 ms or twice baseline, and first requests above three seconds.

Production renders document routes through SvelteKit in the Cloudflare Worker.
Markdown parsing, diagrams, worksheet execution and search indexing remain build
tasks. Compiled content is stored in the Worker asset deployment, alongside the
client application; no R2 service is required.

## Commands

- `bun run build:all`: prepare a complete SSR deployment, reusing compatible app,
  content and search products.
- `bun run build:app`: prepare/cache the application without replacing a complete
  deployment with an application-only tree.
- `bun run build:content`: prepare both content editions and a complete deployment;
  compile the application if no compatible artifact exists.
- `bun run build:static`: produce the two static editions for static hosting.
- `bun run deploy:incremental`: explicitly upload the prepared deployment using
  Cloudflare's asset manifest API. Requires the account and API credentials.
- `bun tooling/verify-deployment.ts`: verify the anonymous HTML response contains
  the expected application and public-content version headers.

## Reuse boundaries

The application cache covers maintained code, dependencies, compile environment,
runtime identity and maintained static assets. Generated note data, navigation and
file icons are read at runtime and do not change the application artifact.

The compiler saves compact metadata and content-addressed rendered bodies and
PageDocs separately for public and full editions. An ordinary edit resolves and
serializes changed bodies, and updates affected backlinks. Link-universe and
affected transclusion changes conservatively replay the existing resolution
algorithm. Output existence alone never establishes cache validity.

Pagefind retains one index per edition. Indexing inputs are compiled article HTML
and metadata plus file records, without rendering every Svelte page. Folder and
tag indexing uses meaningful content rather than incidental shell text. Complete
index products are reused only when their exact inputs and Pagefind version match.

SSR HTML keys include application, edition, route and effective content/navigation
dependencies. Missing per-route keys fall back to the whole snapshot. Runtime
content data has an estimated 16 MiB retention budget; oversized pages are not
retained. Cache eviction or failure causes ordinary rendering.

## Publication and deployment

The Worker blocks direct requests to `/_content` and `/_published`, including
encoded variants. Only trusted asset-binding reads access internal snapshots.
Authentication selects the full edition before protected HTML cache lookup;
cookies and response security headers are applied afterward. Anonymous readers
use the public edition, including sanitized locked previews.

Packaging emits a complete ownership-checked asset inventory and descriptor.
The uploader submits that inventory, verifies requested bodies, and uploads only
hashes Cloudflare requests. Prepared Worker modules come from Wrangler's offline
multipart output. Deployment preserves configured bindings and secret bindings,
and verifies existing domain and preview settings. No private SvelteKit
prerender-resumption interfaces are used.

GitHub stores encrypted global, course, search and application products as
independent archives. A JavaScript action uses the official cache SDK, restores
global selectors before exact course groups, and limits transfers to four at a
time. Only trusted main builds save production products. Invalid or missing
products rebuild through the normal path. Legacy compiler caches remain a
separate fallback for ASTs, history and R previews.

Local asset hash acceleration uses actual bytes on misses and current inode,
size and nanosecond timestamps on hits. Files modified within the last second
always rehash because filesystems may coalesce rapid timestamp updates. These
local stamps are never transported as portable validity evidence.

## Timing and remaining constraints

CI verifies exact live version headers after upload. Its report uses GitHub job
`started_at` when available and explicitly labels first-step timing otherwise.
Queue time is excluded; checkout, dependency/tool setup, cache transfer, indexing,
upload and verification belong in the deployment measurement.

Full recursive checkout and R installation remain in the production workflow.
The compact compiler cache cannot establish correctness for absent courses:
discovery, Git dates, file catalogs and history still need materialized sources.
Selective checkout requires complete, portable per-course source/output capsules
bound to exact recursive gitlinks. It must not be enabled by simply omitting
courses or accepting reduced file counts.

Sub-30-second deployment is an acceptance target, not an established result.
Fresh GitHub-runner and live Cloudflare benchmarks are required before making
that claim. Local CPU speed and warm filesystem caches are not CI evidence.

## Local validation

The complete 1,655-note corpus was measured on the development machine with
Node 25.9.0 and Bun 1.4.0. These are build measurements, excluding checkout,
cache transfer, Cloudflare upload and activation:

| Scenario                     |                        Elapsed time |
| ---------------------------- | ----------------------------------: |
| Unchanged warm build         |                             13.27 s |
| Five ordinary one-note edits | 22.72 s median; 22.67–23.03 s range |

All six builds reused the application. Each edit loaded one Markdown AST per
edition; none rendered social cards or R worksheets. Rebuilding the full search
index took 9.06–9.25 seconds per edit. Original note bytes were restored, and the
main checkout remained unchanged.

Three warm development starts had median readiness of 2.64 seconds and first
homepage HTML of 8.34 seconds. Prewarming five shared SSR components improved
the median by only 0.07 seconds, with inconsistent paired results, so it was
not adopted. All measured warm starts reused saved content without rebuilding.
An excluded cold development prime after compiler changes took 124.38 seconds
to first HTML, including 113.26 seconds preparing content. Cold startup remains
a separate cost; the warm figures do not describe it.

Publication fixtures verify snapshot updates without recompiling the app,
public/full separation, revocation, hidden asset denial, and decompressed search
index privacy. A separate fixture verifies static HTML, file-browser fallback
and both search indexes. Browser checks cover hydration, file viewing,
authentication, navigation and no-JavaScript behavior.
The isolated development integration fixture verifies restart reuse, offline
edits, missing-output recovery, lazy history, additions, deletions and publication
revocation; its changed note became visible in 810 milliseconds.
