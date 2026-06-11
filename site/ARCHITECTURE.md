# wisconsin.twango.dev → SvelteKit Rewrite: Architecture & Migration Report

Synthesized from five research tracks: cca architecture deep-dive, Quartz feature inventory (local fork), Obsidian/Svelte ecosystem survey, Cloudflare/SvelteKit hosting research, and content-pipeline design. Conflicts between reports are resolved explicitly in §1.7.

---

## 1. Executive Summary & Recommendation

**Stack:** SvelteKit 2 + Svelte 5 (runes) + Tailwind 4 + bits-ui + `@lucide/svelte` + mode-watcher — i.e., cca's exact frontend stack, scaffolded the same way (`sv create` with prettier, tailwindcss+typography, adapter-cloudflare/workers, mcp; **minus** better-auth and drizzle, **minus mdsvex**). Package manager: bun.

**Markdown pipeline: a standalone two-pass unified prebuild — NOT mdsvex, NOT ecosystem plugins.** Vendor the wisconsin fork's own Quartz transformer code (it is MIT and locally patched in ways the live URLs depend on):

- `quartz/util/path.ts` — slugging + the **custom nearest-match wikilink resolution** (suffix-match on `/` boundary, ambiguity broken by longest shared dir prefix → shallowest → lexicographic). Port **verbatim**; 3,947 wikilinks across 16 courses with duplicate basenames (`README`, `Instructions`, `exam-1`) depend on this exact algorithm. Stock `remark-wiki-link` / `@flowershow/remark-wiki-link` / Quartz-upstream resolution will all mislink.
- `quartz/plugins/transformers/ofm.ts` — wikilinks/embeds/callouts/highlights/comments grammar (fork adds `callout-content` divs for grid-collapse animation).
- `quartz/plugins/transformers/lastmod.ts` — **submodule-aware git dates** (parses `.gitmodules`, maps file → owning repo). Stock git-date logic returns wrong dates for 100% of course content.
- `quartz/plugins/transformers/autotag.ts` — directory-derived tags that drive tag pages and graph clustering.

Around that vendored core, use commodity unified plugins: remark-gfm, remark-math 6 + rehype-katex 7, Shiki 4 (reuse cca's dual-theme `highlight.js` pattern: `github-light`/`github-dark`, `defaultColor: false`, CSS dark swap), rehype-raw. The ecosystem report's drop-ins (`rehype-callouts`, `@flowershow/remark-wiki-link`) are fallbacks only — none replicates the fork's resolution or the `[!success]-` collapsed-callout fidelity (2,308 instances) without QA risk.

**Rendering model:** prebuild script (`scripts/build-content.ts`, run before `vite build`, wrapped in a thin Vite plugin for dev HMR) emits per-page rendered HTML JSON + a global `content-manifest.json` (slug → title/dates/tags/links/backlinks/folder tree). A catch-all route `src/routes/[...slug]/+page.server.ts` with `entries()` from the manifest renders `{@html}` inside cca's `DocShell`/`prose` chrome. `export const prerender = true` sitewide. Svelte hydrates only islands: mermaid, graph, search palette, popovers, callout collapse.

**Adapter & hosting:** `@sveltejs/adapter-cloudflare` targeting **Workers static assets** (Pages is in maintenance; all new CF features land on Workers — https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/). Fully prerendered pages bypass the Worker and are served free/unlimited; the Worker slot stays open for future redirects beyond the 2,100-rule `_redirects` cap, OG images, or per-course gating. ~3.5k output files fits the 20k free-plan cap with 5× headroom; 25 MiB/file limit is fine once gitignored ML checkpoints are excluded (see §4).

**CI: GitHub Actions, not Workers Builds.** Workers Builds' submodule handling is undocumented and has broken for private submodules post Pages→Workers migration (https://www.answeroverflow.com/m/1384675816935264387, https://community.cloudflare.com/t/failed-error-occurred-while-updating-repository-submodules/828002). This repo has private submodules with multiple remotes. Use `actions/checkout` with `submodules: recursive` + deploy keys, then `wrangler deploy` via `cloudflare/wrangler-action`.

**Search:** Pagefind 1.5.x postbuild over the prerendered output (lazy-loaded chunks, ~100–300 kB total payload even at 10k pages — https://pagefind.app/), surfaced through cca's `SearchPalette` UI shell (bits-ui Dialog+Command, ⌘K) calling Pagefind's JS API instead of minisearch.

### 1.7 Conflict resolutions (explicit)

| Conflict | Reports | Resolution |
|---|---|---|
| mdsvex (cca) vs plain unified | cca-architecture vs ecosystem + pipeline reports | **Plain unified.** Wikilink resolution, backlinks, and graph need whole-corpus knowledge; mdsvex is per-file and compiles 660 components into the Vite graph (MDsveX #294). cca's mdsvex choice made sense for in-`src` authored docs; wisconsin's corpus is out-of-tree submodule content with zero Svelte-in-markdown. We still reuse cca's *non-mdsvex* pipeline pieces: Shiki highlighter module, KaTeX global CSS import, admonition CSS, mermaid base64-passthrough + lazy-import component pattern. |
| minisearch/API endpoint (cca) vs Pagefind vs FlexSearch (Quartz) | all four | **Pagefind.** cca's server endpoint existed because the site is auth-gated; wisconsin is public and fully prerendered, so a static, chunked index wins. Keep cca's palette UI for visual continuity. FlexSearch parity isn't required — UX parity is. |
| adapter-cloudflare vs adapter-static | cloudflare report (calls it low-stakes) | **adapter-cloudflare**, prerendered. One-line switch either way; keeps the Worker slot free. |
| Vendor Quartz v5 community plugin vs local fork | ecosystem vs feature-inventory/pipeline reports | **Local fork.** The v5 `quartz-community/obsidian-flavored-markdown` repo is cleaner code, but the fork's patches (nearest-match resolution, callout divs, autotag, lastmod) define the live site's behavior. Use v5 sources as a structural reference only. Do not chase Quartz 5 as a moving target — the regression baseline is the deployed site. |
| trailingSlash 'always' (cca/MkDocs) vs Quartz URLs | cca vs feature inventory | **`trailingSlash: 'never'`** (SvelteKit default). Live URLs are `/sp26-cs537/README` with no trailing slash; Workers assets' default `html_handling: auto-trailing-slash` serves `foo.html` at `/foo`. cca's 'always' was an MkDocs-ism; do not import it. |
| Graph: force-graph vs sigma vs pixi (Quartz) | ecosystem report | **force-graph** (56 kB gz incl. d3-force), dynamically `import()`-ed; canvas is ample at 660 nodes. |

---

## 2. Visual Identity Transfer Plan ("cca × wisconsin")

**Lift from cca verbatim** (paths relative to `/home/jding/WebstormProjects/cca`):

- `src/routes/layout.css` — the single source of truth: Tailwind 4 `@theme` tokens, `@custom-variant dark (&:where(:root.dark, :root.dark *))`, prose remaps, admonition styles, thin themed scrollbars, Shiki dark-swap rule, heading weight override (semibold + `-0.025em` tracking, `scroll-margin-top: 5rem`).
- `static/fonts/*` + `@font-face` blocks: **Overused Grotesk** (sans), **JetBrains Mono** (mono), Virgil (reserve). These replace wisconsin's Google-Fonts trio (Schibsted Grotesk / Source Sans Pro / IBM Plex Mono) — self-hosted variable fonts, better identity match with twango.dev family.
- `src/lib/components/doc/`: `DocShell` (16rem sidebar / `max-w-3xl` content / 14rem TOC grid, mobile slide-in at ≤768px), `Sidebar`, `NavTree` (native `<details>`, natural sort), `Toc`, `DocPager`, `enhancements.ts` (drop `filePreviews`, `kotlinPlayground`).
- `src/lib/components/ui/*` (Button variants, Dialog/Tooltip/Select wrappers, ThemeToggle, layout primitives), `src/lib/utils.ts` (`cn()`), `SEO.svelte`, `mode-watcher` wiring with `defaultMode="dark"`.
- `src/lib/components/search/` palette UI + `search-state.svelte.ts` + ⌘K binding (rewired to Pagefind).
- Mermaid embed component + base64 passthrough; KaTeX CSS global import; admonition kind colors.

**Wisconsin keeps the accent.** The baby's genome: cca's warm-paper neutrals + typography + layout, wisconsin's **red** identity. In `@theme`:

```css
--color-accent: #d35545;          /* wisconsin light red (was cca #167bff) */
--color-accent-soft: #f7e4e1;     /* derive: red-tinted, replaces #e6eef7 */
:root.dark { --color-accent: #e68578; --color-accent-soft: #3f1f1b; }
```

Everything downstream (NavTree active state `bg-[--color-accent-soft] text-accent`, prose links, focus rings, Button default `bg-accent`, `<mark class="bg-accent/20">` search highlights) inherits automatically — this is the payoff of cca's token discipline. Optionally re-tint the bloom palette (`--bloom-*`) to the red family for a homepage hero flourish; otherwise drop `AuthBackground`/`bloom.wgsl` entirely (it was login-page eye candy).

**Wisconsin-specific chrome to add (no cca equivalent):** Backlinks panel, local/global Graph, Breadcrumbs (hidden on home), ReaderMode toggle (fork-custom — decide keep/drop, §5), Explorer = cca's NavTree (collapsed-by-default sections), tag chips/pages, ContentMeta (modified date + reading time). Callout styling: keep the fork's grid-collapse animation classes but restyle to cca's flat aesthetic (1px `border-border`, 4px left accent, `rounded-lg`, `--color-surface` bg). Fix the footer (currently stock Quartz jackyzha0 links — unintentional).

---

## 3. Zero-Regression Matrix

Legend: ✅ solved (proven implementation exists) · 🟡 needs work (clear path, must build/verify) · 🔴 risk (open design or fidelity hazard). "Source" = where the implementation comes from.

| Quartz feature (usage) | Svelte-side implementation | Conf. | Source |
|---|---|---|---|
| Wikilinks `[[x]]` (3,947) | Vendored `ofm.ts` grammar + vendored patched `transformLink` | ✅ | wisconsin fork `quartz/plugins/transformers/ofm.ts`, `quartz/util/path.ts` |
| Aliased `[[x\|y]]` (2,474) | same | ✅ | same |
| Heading anchors `[[x#h]]` (48) | same + github-slugger ids on headings (build-time, replacing cca's runtime `headingAnchors`) | ✅ | fork `ofm.ts` `slugAnchor`; verify with `handleMissingId: 'error'` |
| Nearest-match resolution (duplicate basenames) | Verbatim port of patched suffix-match + tie-break | ✅ | fork `path.ts` (commits c508392, 8399e6e) — **golden-diff against current `public/` hrefs** (Phase 1) |
| Transclusions `![[note]]`, `![[note#h]]` (~9 note + 307 total embeds) | Resolve at **build time** in pass 2 (inline target section HTML, depth-limited, re-based inner URLs, "link to original") — improves on Quartz's render-time hack | 🟡 | fork `renderPage.tsx` logic, moved into prebuild stage 2 |
| Image embeds (297) incl. `alt\|WxH` sizing | `ofm.ts` embed branch → `<img>`; assets copied under slugified paths | ✅ | fork `ofm.ts` `wikilinkImageEmbedRegex` |
| PDF embeds (7) | `<iframe class="pdf">`; `#page=N` anchors pass through raw | ✅ | fork `ofm.ts` + `path.ts` `splitAnchor` PDF special case |
| Callouts (4,487; 2,308 are `[!success]-` collapsed) | Vendored callout transform incl. fork's `callout-content` grid-collapse divs; tiny hydration or `<details>` for collapse; both lower/UPPER type names | ✅ | fork `ofm.ts` + restyled CSS (cca admonition tokens) |
| KaTeX `$`/`$$` (130/71 files) | remark-math 6 + rehype-katex 7 in prebuild (no mdsvex → no escape/normalize hacks needed); global katex CSS | ✅ | commodity; cca's CSS import pattern |
| Mermaid (158 blocks) | Fence passthrough → lazy client `import('mermaid')` component, raw-source no-JS fallback | ✅ | cca `highlight.js` passthrough + `embeds/Mermaid.svelte` |
| Shiki highlighting (1,365 fences, 25 langs incl. `asm`, `console`, `git`, `makefile`, `dockerfile`) | Shiki 4 dual-theme, preload full lang list; unknown → plaintext | 🟡 | cca `markdown/highlight.js`; **verify asm/console/git grammars render** |
| GFM tables/tasks/strikethrough (290 files, 3,353 checkboxes) | remark-gfm + smartypants | ✅ | commodity |
| Highlights `==x==` (35) | `ofm.ts` | ✅ | fork |
| `%%comments%%` hidden (4 files) | `ofm.ts` text-phase strip | ✅ | fork |
| Frontmatter (251 files; `date`, `title`, `tags`, paper-notes keys) | gray-matter in prebuild; title fallback chain title→H1→filename | ✅ | pipeline design; cca `deriveTitle` pattern |
| AutoTag (course/term/subject tags) | Port `autotag.ts` into prebuild stage 1 | ✅ | fork `quartz/plugins/transformers/autotag.ts` |
| Inline `#tag` + FM tags | `ofm.ts` tag parse | 🟡 | fork; audit C `#include` false positives during golden diff |
| Tag pages `/tags/<tag>` | Prerendered route from manifest tag index | ✅ | manifest |
| Folder pages `/<dir>/` (all 16 course landings!) | Prerendered listing route for every folder w/o `index.md`, from manifest tree | ✅ | manifest; URL semantics preserved (README stays separate at `/<course>/README`) |
| Slugs (case-sensitive, spaces→`-`, `&`→`-and-`, ext-strip md/html only) | Shared `slug.ts`, verbatim port | ✅ | fork `path.ts` `slugifyFilePath`/`sluggify` — golden-diff slug set |
| SPA navigation | SvelteKit client router + `data-sveltekit-preload-data="hover"`; optional `onNavigate` + `startViewTransition` (https://svelte.dev/blog/view-transitions) | ✅ | SvelteKit native |
| Hover popovers | Quartz's own trick: `fetch(href)` of prerendered page + DOMParser, extract main content, per-URL cache; heading-anchor scroll | 🟡 | https://quartz.jzhao.xyz/features/popover-previews pattern; build as Svelte attachment |
| Graph view (local depth-2 + global) | `force-graph` (56 kB gz) lazy-imported; data = manifest links; local = client-side depth-2 filter; color by AutoTag course | 🟡 | https://github.com/vasturiano/force-graph |
| Backlinks panel | Inverted link map computed in prebuild stage 2, in manifest, rendered server-side | ✅ | pipeline design (Quartz ContentIndex pattern) |
| TOC | Build-time TOC in page JSON → cca `Toc.svelte` | ✅ | cca + prebuild |
| Search (FlexSearch, `/` key, tag search) | Pagefind postbuild + cca SearchPalette; bind both `/` and ⌘K; tag filters via Pagefind filters | ✅ | https://pagefind.app/ ; cca palette UI |
| Explorer | cca `NavTree` fed by manifest folder tree | ✅ | cca |
| Dark mode | mode-watcher + ThemeToggle | ✅ | cca |
| ReaderMode toggle (fork custom) | Svelte store + CSS class hiding rails | 🟡 | trivial rebuild; or drop (ask user, §5) |
| Breadcrumbs | Small component from slug segments, hidden on `/` | ✅ | trivial |
| Git dates incl. submodules | Port `lastmod.ts` design; batch `git -C content/<course> log --format='%H %ct' --name-only` per submodule → path→epoch map; cache keyed on submodule HEAD; priority frontmatter→git→fs | ✅ | fork `lastmod.ts` (already solves this exact problem) |
| ContentMeta (modified date + reading time) | manifest fields + reading-time calc | ✅ | trivial |
| RSS `/index.xml` (limit 10) + `/sitemap.xml` | Prerendered `+server.ts` endpoints reading manifest | ✅ | manifest |
| Plausible | Script tag in `app.html` / root layout | ✅ | trivial |
| 404 | SvelteKit error page + Workers assets fallback | ✅ | native |
| Favicon / static OG image | `static/` | ✅ | trivial (custom OG already disabled in Quartz) |
| Drafts (`draft: true`) | Skip in prebuild stage 0 | ✅ | trivial |
| gitignore-aware publishing (**critical**: 14.5k files/5.8 GB on disk → ~3.4k published) | `git ls-files` per submodule (authoritative) + type whitelist + link closure (§4) | ✅ | pipeline design; stricter than Quartz's globby+gitignore |
| Raw HTML in md (homepage badges) | rehype-raw | ✅ | commodity |
| Description meta | First-paragraph excerpt in prebuild | ✅ | trivial |
| Broken-wikilink rendering (`a.internal.broken`) | 0-match → root-absolute fallback + build warning; fail build on broken **page** links via prerender `handleHttpError` | ✅ | fork behavior + SvelteKit `handleMissingId`/`handleHttpError` |
| Alias redirects | 0 aliases in content today; support via `_redirects` emission if added later | ✅ | n/a currently |

Not used, no regression possible: block refs `#^id` (0 links), footnotes (0), RecentNotes, comments, CNAME.

---

## 4. Content Pipeline Design

### Include/exclude
```
PAGES:   git-tracked **/*.md   (via `git ls-files` per submodule — NOT globby)
ASSETS:  always: **/*.{png,jpg,jpeg,gif,svg,webp,pdf}  (~470 images + 2 cheatsheet PDFs)
         closure: any other tracked file referenced by a resolved link from an
                  included page (e.g. `](solution/parser.c)`) → copy
EXCLUDE: ignorePatterns private/, templates/, .obsidian/; draft:true; everything
         untracked (kills the 4.8 GB cs639 checkpoints and 5.7k-file cs544 venv)
```
Closure-copy (vs rewriting code links to GitHub blob URLs) **preserves today's behavior exactly** — Quartz currently ships every tracked non-md file (~2,578 assets incl. 285 .java/268 .c). Closure shrinks that to only-what's-linked while keeping all live link targets working. Exclusion is by file type + reference, never by directory: content md lives inside code dirs (`sp26-cs537/p1/Instructions.md`).

### Slugs & redirects (live URLs must survive)
Port `slugifyFilePath` verbatim into a shared `slug.ts`: whitespace→`-`, `&`→`-and-`, `%`→`-percent`, strip `?#`, **no lowercasing**, extension stripped only for `.md/.html`, `_index`→`index`, trailing-`index` trimmed for display URLs. Heading anchors: github-slugger; PDF anchors pass raw (`#page=N`). `trailingSlash: 'never'`. Result: **zero redirects needed** — every live URL (`/sp26-cs537/README`, `/fa25-cs354/exams/exam-1/review`, `/tags/cs544`, `/index.xml`, asset paths like `/…/Pasted-image-20260201134656.png`) resolves identically. If lowercase-clean URLs are ever wanted, the manifest can emit a 301 map into `_redirects` (2,000-rule native support on Workers assets) — defer; do not couple to launch.

### Link resolution (the patched algorithm, normative spec)
1. Normalize: `decodeURI`, split anchor, strip `./`/`../`, slugify, trim trailing `index` → `targetCanonical`.
2. Candidates: all page slugs `s` with `s === targetCanonical || s.endsWith("/" + targetCanonical)`.
3. One candidate → resolve (+slugified anchor). Multiple → longest shared dir-prefix with source, then shallowest, then lexicographic. Zero → root-absolute `/<targetCanonical>` (this is how code/PDF asset links work; warn if no emitted asset matches).
4. Apply identically to wikilinks, md links, and `img/video/audio/iframe` src. Record resolved simple-slugs per page → invert for backlinks → manifest.

### Pipeline stages
0. **Discover** — `git ls-files` per submodule + root files; classify page/asset; compute slugs.
1. **Parse** (per file, cacheable) — gray-matter → OFM text-phase (comments, table escapes, external-URL wikilinks) → remark-parse/gfm/math → OFM mdast (wikilinks, callouts, highlights, tags, embed placeholders) → AutoTag → rehype/raw/KaTeX/Shiki/heading-ids. Collect title, description, TOC, headings.
2. **Resolve (global)** — with full slug set: link resolution, transclusion inlining (depth-limited), asset closure, backlink inversion, git-date map merge.
3. **Emit** — `content-manifest.json` (nav tree, tags, links/backlinks, dates, redirect map), `pages/<slug>.json` (HTML + TOC + backlinks), assets copied to output under slugified paths.
4. **Prerender** — `[...slug]` route + folder-listing + tag routes + RSS/sitemap endpoints; `entries()` from manifest; `prerender = true`; prerender errors fail the build (`handleHttpError`, `handleMissingId: 'error'` = free broken-anchor CI).
5. **Postbuild** — `pagefind --site <outdir>`.

Incremental dev: cache stage-1 output keyed on `(content hash, slug-set hash)`; Vite plugin watches `content/**` and refires via virtual module.

### Git dates
Per submodule: one `git log --format='%H %ct' --name-only` walk → `{path → last-modified epoch}`; root `index.md`/`course-log.md` from superproject. Frontmatter `date:` (164 files) wins per-field; fs `birthtime` fallback. Cache by submodule HEAD sha. (Design straight from the fork's `lastmod.ts`.)

### Search indexing
Pagefind over prerendered HTML; mark the article container `data-pagefind-body`; expose course + tags as Pagefind filters/metadata; exclude nav/TOC rails. Section-level sub-results give Quartz-parity deep links. `/` and ⌘K both open the palette.

---

## 5. Risks & Open Questions for the User

1. **Code-asset closure vs GitHub rewrite.** Recommended: closure-copy (exact behavior parity). Alternative: rewrite `](solution/parser.c)`-style links to submodule GitHub blob URLs — smaller deploy, but changes behavior for private submodules (broken for logged-out readers). **Decision needed.**
2. **ReaderMode toggle** — fork-custom, low usage signal. Keep (cheap) or drop? Default: keep, it's ~30 lines.
3. **Fonts**: plan replaces Schibsted Grotesk/Source Sans/IBM Plex Mono with cca's Overused Grotesk/JetBrains Mono. If wisconsin's type identity should survive instead, that inverts §2. Default: cca fonts win ("the baby looks like cca, wears wisconsin red").
4. **Shiki grammar coverage** for `asm`, `console`, `git`, `makefile` fences (48 asm blocks) — verify in Phase 2; fallback plaintext is a visible (minor) regression vs rehype-pretty-code today.
5. **Mermaid at 158 diagrams** — client-side render is the Quartz status quo (parity), but build-time `rehype-mermaid` (playwright) would beat it; adds CI weight. Default: client-side, revisit later.
6. **Inline `#tag` extraction noise** (C `#include` etc.) — the fork's behavior is the baseline; golden-diff will reveal whether it currently produces junk tags worth fixing-not-replicating.
7. **Private submodule CI**: deploy keys/PAT setup for 16 submodules in GitHub Actions; SSH URLs already in `.gitmodules` per recent commits — needs a key with org-wide read or per-repo keys. Operational, not architectural.
8. **Quartz 5 drift**: baseline is the deployed Quartz-4-fork site, not upstream. Explicitly out of scope to match v5 features (per ecosystem report's suggestion) — confirm.
9. **Popover/graph fidelity** is the least "drop-in" chrome (🟡 above); both follow proven patterns but need real QA on this corpus.
10. **Plausible + footer**: footer currently shows stock Quartz links (jackyzha0) — fix in rewrite, confirm desired footer content.

---

## 6. Phased Implementation Plan

**Phase 0 — Scaffold + deploy skeleton (de-risk hosting & CI first).**
`sv create` (cca recipe minus auth/db/mdsvex); port layout.css/fonts/tokens with red accent; wrangler.jsonc (no R2); GitHub Actions with `submodules: recursive` + deploy keys + `wrangler deploy` to a preview Worker. *Exit: hello-world SvelteKit site live on Workers from CI with all 16 submodules cloned.*

**Phase 1 — Pipeline core + golden-diff harness (the critical de-risk).**
Stage 0–2 of the prebuild: discovery, verbatim `slug.ts` + `transformLink` port, manifest emission. Build a **parity harness**: run the existing Quartz build, extract (a) the full slug set, (b) every resolved internal `href` per page from `public/`, and diff against the new pipeline's output. *Exit: 100% slug parity, ≥99.9% link-resolution parity with explained diffs. This single artifact proves the two Blocker features (resolution + slugs) before any UI exists.*

**Phase 2 — Rendering fidelity.**
Stage 1/3: callouts (incl. `[!success]-` collapse), KaTeX, Shiki (verify asm/console/git), GFM, highlights, comments, embeds (img/PDF), build-time transclusions, raw HTML. Spot-diff rendered HTML for the heaviest pages (cs537 exams, cs544 README, homepage with `![[course-log]]`). *Exit: visual side-by-side of ~20 representative pages.*

**Phase 3 — Site chrome.**
DocShell/Sidebar/NavTree (Explorer), TOC, Breadcrumbs, ContentMeta with submodule git dates, DocPager, dark mode, ReaderMode, folder + tag pages, 404, footer fix. Prerender all routes; `handleMissingId: 'error'` clean. *Exit: full site browsable locally, every live URL resolves.*

**Phase 4 — Interactive features.**
Pagefind + palette (`/`, ⌘K), backlinks panel, force-graph (local depth-2 + global), hover popovers, view transitions. *Exit: feature-matrix 🟡 items → ✅.*

**Phase 5 — Cutover.**
RSS/sitemap, Plausible, `_headers` cache rules, crawl the old sitemap against the new deploy (expect 0 non-200s), DNS switch wisconsin.twango.dev to the Worker, keep Quartz build runnable for one term as fallback.

Rough effort centers on Phases 1–2 (the pipeline is the project; the UI is mostly a cca transplant).

---

## Critique addendum

Adversarial gap-check against the live repo (`quartz.config.ts`, `quartz.layout.ts`, `.github/workflows/build-and-deploy.yaml`, built `public/`, fork sources). Verified-correct claims are listed at the end; gaps first, ordered by severity.

### A. Current host is GitHub Pages, not Cloudflare — two report claims are wrong as a result
`.github/workflows/build-and-deploy.yaml` deploys `public/` via `actions/deploy-pages@v4` (GitHub Pages, custom domain wisconsin.twango.dev), with submodules already cloned via `actions/checkout` + `submodules: recursive` + `secrets.PAT_TOKEN`.
1. **Risk #7 is already solved in production.** The report speculates about "deploy keys / a key with org-wide read or per-repo keys" for 16 private submodules. A working `PAT_TOKEN` secret exists in the current workflow and clones all submodules today — the new GitHub Actions pipeline should simply reuse it. Delete the open question.
2. **"Zero redirects needed" (§4) is false for folder pages.** Quartz emits folder pages as `<dir>/index.html` and its own internal hrefs use trailing-slash form (verified in `public/sp26-cs537/p1/README.html`: `../../sp26-cs537/`, `../../sp26-cs537/p1/`, `../../exams/midterm-1/`); GH Pages 301s `/<dir>` → `/<dir>/`, so the *canonical live URL of every folder page has a trailing slash*. With the mandated `trailingSlash: 'never'`, all of those flip canonical form and historical `/<dir>/` links survive only via Workers' auto-trailing-slash 307. Functionally OK, but: (a) the matrix row "Folder pages `/<dir>/`" is internally inconsistent with §1.7's `'never'` resolution; (b) external links/bookmarks to course landings will all redirect. State this explicitly and confirm `'never'` is still wanted (it probably is — page URLs dominate — but it is not "zero redirects").

### B. The Phase 5 verification gate is too weak to catch the URLs that matter
`public/sitemap.xml` contains 639 `<loc>` entries — **all leaf pages**. It contains zero folder pages, zero `/tags/*` URLs, and zero assets. "Crawl the old sitemap, expect 0 non-200s" therefore verifies none of: 16 course landing pages, nested folder pages (`/sp26-cs537/p1/`…), the `/tags` index, 168 tag pages, or ~2,500 asset URLs. Replace the gate with: diff the full old `public/` file list (3,445 files) against the new output path set, and crawl that.

### C. Closure-copy demonstrably breaks live URLs (contradicts "preserves today's behavior exactly")
§4 claims closure-copy "preserves today's behavior exactly … keeping all live link targets working." Counter-examples found: large data files served today but referenced **only in code blocks/prose, never as resolvable links**, so the closure rule drops them:
- `/sp26-cs544/p4/hdma-wi-2021.sql.gz` (22.6 MB — mentioned in a shell fence in `p4/README.md`)
- `/sp26-cs544/demos/mysql/hdma-wi-2021.parquet` (16.6 MB)
- `/fa25-cs540/hw3/celeba_218x178x3.npy` (11.6 MB — prose mention only)
All three exist in `public/` and are fetchable today (students may `wget` them). Risk #1's decision framing is fine, but the pipeline must emit a **dropped-URL manifest** (old asset set minus closure set) for human review before cutover — likely hundreds of unlinked-but-tracked files.

### D. 25 MiB per-file Workers cap: near-miss, needs a guard
Largest tracked-and-shipped file is 22.6 MiB (`hdma-wi-2021.sql.gz`) — within ~10% of the 25 MiB hard cap. No file exceeds it today (verified across all submodules), but one bigger dataset next term fails the **entire deploy**. Add a prebuild size assertion (warn >20 MiB, fail >25 MiB) rather than discovering it in CI.

### E. Missing regression-matrix rows
1. **`/tags` index page** — `public/tags/index.html` exists (lists all 168 tags). Matrix only covers `/tags/<tag>`. Also: tag slugs are case-sensitive (`/tags/ELF`, `/tags/Makefiles`, `/tags/Placement-policies`) — tag slugging must preserve case, same as page slugs; include tags in the golden-diff slug set.
2. **Code-block copy button** — `clipboard.inline.ts` is wired through `Body.tsx` on every page; all 1,365 fences have a copy button today. User-visible if forgotten. (Same family: mermaid expand/copy controls in `mermaid.inline.ts`.)
3. **External-link icon** — `CrawlLinks` defaults `externalLinkIcon: true`; every external link renders an inline SVG today. Cosmetic — decide keep/drop deliberately, don't lose it silently.

### F. Smaller factual corrections
1. **OFM transformer runs twice** in `quartz.config.ts` (line 74 with `{enableInHtmlEmbed:false}`, line 80 with defaults). The report's pipeline assumes single application. Likely idempotent (first pass consumes the wikilink syntax), but the Phase 1 golden diff is slug/href-level only — confirm idempotence in the Phase 2 HTML spot-diff, or replicate double application.
2. **ReaderMode is stock Quartz, not "fork-custom"** (§2, §5.2, matrix row): `git log` shows it arrived via upstream `feat: reader mode` / i18n PR #1961. Doesn't change the keep/drop call, but the report's provenance claim is wrong.
3. §1 says "2,100-rule `_redirects` cap", §4 says "2,000-rule" — both are sort-of right (2,000 static + 100 dynamic); pick one phrasing.

### Verified correct (no action)
16 submodules confirmed; `des-inv` is the 16th content dir (AutoTag-excluded, as configured). Zero `aliases:` frontmatter in content — AliasRedirects is a live no-op, matching the matrix. `enableCheckbox` defaults false and is unset — no checkbox-persistence regression possible. RSS limit 10 confirmed in `public/index.xml`. Output is 3,445 files / 329 MB — fits the 20k-file cap as claimed. Fork's nearest-match resolution patches exist as cited (commits c508392, 8399e6e in `quartz/util/path.ts`, `strategy: "shortest"` wired via `CrawlLinks({ markdownLinkResolution: "shortest" })`). Footer is indeed stock jackyzha0 links. All cited cca paths exist (`doc/DocShell.svelte`, `search/SearchPalette.svelte`, `routes/layout.css`, `static/fonts/{OverusedGrotesk,JetBrainsMono}*`). Wisconsin red `#d35545`/`#e68578` matches `quartz.config.ts` theme exactly.
