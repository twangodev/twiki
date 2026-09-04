# Phase 2b — Rendering-fidelity spot-diff notes

Method: `bun scripts/spot-diff.ts` compares the Quartz baseline (`public/<page>.html`,
`<article class="popover-hint">` / FolderPage `<article class>` body) against the new
pipeline's injected HTML (`site/.generated/pages/<slug>.json`). Two checks per page:
structural feature counts (callouts, collapsed callouts, fences, tables, images, katex
roots, iframes, checkboxes, internal/external links, mermaid, highlights, headings) and
normalized text-content equality (tags stripped; Quartz heading-anchor `<a role="anchor">`
chrome and KaTeX presentation spans normalized out). Interaction checks ran against the
prerendered Workers build (`.svelte-kit/cloudflare`) in headless Chromium.

## Result: 14/14 representative pages match (counts + text)

| page                                                | why chosen                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `course-log`                                        | transclusion source                                                      |
| `fa25-cs354/exams/exam-1/practice`                  | collapsed `[!success]-` house exam format + asm fences                   |
| `fa25-cs354/exams/exam-1/review`                    | callout+table+code cheat sheet                                           |
| `sp26-cs537/exams/midterm-1/sample-1/index`         | folder-page baseline, 71 collapsed callouts, 205 checkboxes, pdf iframes |
| `sp26-cs537/README`, `sp26-cs544/README`            | course landings                                                          |
| `fa25-cs540/exams/final/review`, `…/midterm/review` | KaTeX-heavy                                                              |
| `fa25-anthro105/labs/lab-11`                        | mystery-fossil `.html` asset links, `==highlight==` runs                 |
| `fa25-anthro105/textbook/ch-06`                     | `\|WxH` image embeds                                                     |
| `sp26-cs537/textbook/ch-27`                         | long OSTEP conversion, code-heavy                                        |
| `sp26-cs544/lectures/lecture-25`                    | Mermaid-heavy (3 diagrams)                                               |
| `fa24-asianam160/README`, `fa25-music113/README`    | prose/essay courses                                                      |

## Verified behaviors (headless Chromium against the built output)

- **Collapsed callouts**: `.callout.is-collapsible.is-collapsed` renders title-only
  (`grid-template-rows: 0px`); clicking the title expands to full height (405px on the
  test callout) and the fold chevron rotates. Pure-CSS class toggle, hydrated by
  `calloutFold` in `src/lib/components/doc/enhancements.ts` (keyboard accessible,
  `role=button`/`aria-expanded`).
- **Copy buttons**: 20/20 fences on the test page get hydrated copy buttons (cca pattern).
- **Shiki**: asm/console/makefile/dockerfile grammars load and tokenize (token colors
  byte-identical to baseline rehype-pretty-code since both use github-light/github-dark);
  `sh/zsh/js/txt/plaintext/c++/mysql/gitignore/shellsession` aliased; unknown langs fall
  back to plaintext with a build warning (currently zero unknown langs in the corpus —
  the single ` ```git ` "fence" in sp25-cs400/p213 is a one-line paragraph, not a fence,
  in both pipelines).
- **KaTeX**: global CSS imported in `+layout.svelte` (fonts bundled by Vite); display
  math scrolls horizontally.
- **Light + dark themes**: Shiki CSS-variable swap, callout palette, prose tokens all
  render in both (mode-watcher class toggle).
- **`.html` assets**: emitted as `<slug>.html` (e.g. `fa25-anthro105/assets/
mystery-fossil-RED.html`) so Workers `html_handling` serves the extensionless live URL.

## Known intentional divergences (carried from Phase 1/2a, re-confirmed here)

1. **Heading anchor icons hydrate client-side** rather than being present in the initial
   Quartz HTML; the visible deep-link affordance and heading `id`s are equivalent once JS runs.
2. **Code block DOM**: `pre.shiki` instead of `figure[data-rehype-pretty-code-figure]`;
   same tokens, same dual-theme variables.
3. **Internal-link styling**: cca flat accent links, not Quartz's grey chip background.
   `a.tag-link` keeps the `#` pseudo-prefix; `a.internal.broken` style kept (currently
   unused — the fork's `disableBrokenWikilinks` is off, matching baseline).
4. **`==highlight==`** is accent-tinted (`--color-accent` 25%) instead of Quartz yellow —
   wisconsin-red identity decision.
5. **KaTeX output is HTML-only in both builds** (`output: 'html'`); the earlier claim
   that Quartz emitted HTML+MathML was stale.
6. **Inline-code backticks**: tailwind-typography's `code::before/::after` backticks are
   suppressed (Quartz showed none; cca shows them — content fidelity wins).
7. **Transclusion** is inlined at build time with `Link to original`; baseline did it at
   render time. Output text identical (spot-diff `index` ✓).
8. **ContentMeta** (modified date + reading time) renders inside the article on the new
   site; excluded from diff as new chrome.

## Islands / Verify follow-up

- **Mermaid** (158 fences): lazy client rendering now includes source copy and expanded
  pan/zoom/reset controls. Raw-source fallback remains available without JS or on error.
- **Callout fold without JS**: collapsed callouts cannot be expanded with JS disabled —
  exact parity with Quartz (also JS-driven), but `<details>` could fix it if no-JS ever
  matters.
- **Copy buttons on Mermaid blocks**: implemented in the Mermaid island.
- **Broken-on-live links reproduced bug-for-bug** (flagged in `.generated/warnings.txt`):
  e.g. lab-11's fossil links resolve to root `/assets/mystery-fossil-*` on BOTH sites
  (target actually lives at `/fa25-anthro105/assets/…`); cs537 midterm sample pages
  iframe nonexistent `questions.pdf`/`solutions.pdf`. Candidates for upstream content
  fixes, not pipeline changes — do not "fix" silently before the Verify-phase crawl.
- **Popover previews / graph / search**: implemented and covered by the production-browser
  parity suite, including the Pixi teardown stress sequence and Pagefind course/tag filters.

## Quartz experience audit closure (2026-09-04)

- Heading-anchor click icons restored without changing the frozen heading ids.
- Local graph restored to the repository's Quartz depth 2, widened to the old visual
  footprint, and uses the same Pixi/D3/Tween visualization stack; global graph is 80vw × 80vh.
- Search retains `/` and ⌘K, adds Quartz-style `#tag` shorthand, and indexes distinct course
  and tag filters instead of a malformed composite value.
- Mermaid now has copy, fullscreen, pan, zoom, reset, Escape, and backdrop-close behavior.
- First visit follows the operating-system theme instead of forcing dark mode.
- Wrangler preview tests enforce Cloudflare security/cache headers and no-trailing-slash URLs.
