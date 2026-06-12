# `site/baseline/` — frozen Quartz golden-diff baseline

These files are a **snapshot of the final Quartz build** (repo-root `public/`,
produced by the wisconsin Quartz-4 fork **v4.5.1**) taken the moment before
Quartz was decommissioned from the repo root. They exist so the parity and
anchor-cross-check gates keep running after Quartz is gone — there is no longer a
`public/` to regenerate, so the gates compare the SvelteKit pipeline against
this frozen record instead.

## Provenance

- **Quartz version:** 4.5.1 (root `package.json`, `@jackyzha0/quartz` fork)
- **Content submodule SHAs at freeze time** (`git submodule status`):

  ```
  872645808f6b9925f24d3a65cde169844ed52c45 content/des-inv (heads/main)
  c8d65cb8f3dad9e54de307d4912095788175bad4 content/fa24-asianam160 (heads/main)
  0f225d36f4792a9c9509fd10802c4b1179a288e7 content/fa24-cs300 (heads/main)
  ccb8c7389a3adfd30daa54de3b2081ffc01f4b57 content/fa25-anthro105 (heads/content-overhaul)
  bd106b7d864cb866c8cb0120c203dd7d6f11c7b4 content/fa25-cs300 (heads/main)
  949409bbd242f1ade51c316177992be6766223d8 content/fa25-cs354 (heads/main)
  e230bbbc0ba5932275808efc5d1b04bef857ceaf content/fa25-cs502 (heads/main)
  48bf2f893d1a761b7182b6a78bbcaf272749e978 content/fa25-cs540 (heads/main)
  da05ff19857e11df31e2364ae32fe3d337f11bd1 content/fa25-music113 (heads/main)
  777195c347470c009c6bd550a816082702d335a3 content/fa25-nutrisci132 (heads/main)
  674845c16e774c4c8d00eb019209e138f0fae521 content/sp25-cs400 (heads/main)
  e0140995b3f8d88820a09debe0949c09bc2f585a content/sp25-music113 (heads/main)
  0a5854869b78fd29609a7497ba7fee0739acdaeb content/sp26-cs537 (heads/main)
  b04e0e96d65ba41b3ed5d9a911873ba0e2783529 content/sp26-cs544 (heads/main)
  513cfa75286c4c4a04a448e89d60758743b90884 content/sp26-cs571 (heads/content-overhaul)
  7dea50eb48433c6060af6333c8b575f8cac4eedc content/sp26-cs639 (heads/main)
  ```

- The frozen build was **golden-diff green** at freeze time: 100% slug parity,
  100% link-record parity, 0 unexplained asset diffs (3451 served files, 963
  html pages).

## Files

| file | what it is | consumed by |
|---|---|---|
| `served-files.txt` | every file path under the final `public/` (sorted) | `scripts/parity.ts` (slug set, asset-file diff) |
| `slugs.json` | every baseline `*.html` path minus `.html` (sorted) | `scripts/parity.ts` (derived from served-files; stored for convenience) |
| `link-records.json` | per content page: the `<a data-slug href>` records, **already normalized** exactly as `parity.ts` compares them (`[dataSlug, normalized-href, hash]`) | `scripts/parity.ts` (link parity) |
| `page-ids.json` | per baseline page slug → its set of element `id=""` values (a slug absent from the map means that page did not exist in the baseline) | `scripts/prepare-static.ts` (broken-anchor regression cross-check) |
| `spot-articles.json` | the chrome-stripped `<article>` body for the spot-diff heavy-page set (baseline side only) | `scripts/spot-diff.ts` (content-fidelity spot check) |
| `expected-404.json` | internal link targets broken on the live Quartz site too — whitelisted for the strict prerender crawler | `scripts/prepare-static.ts` regenerates the live equivalent; this is the frozen reference copy |
| `expected-missing-id.json` | in-page anchors broken on the live Quartz site too | same |

## Regenerating

You can't — Quartz is gone. These are intentionally frozen. The extraction
script that produced them was `scripts/freeze-baseline.ts`, run once against the
final `public/`; it has been removed along with Quartz. If a future content
change legitimately diverges from this baseline, update the relevant artifact
by hand (and document why), don't try to rebuild Quartz.

## Retired entries

| slug | file | retired | reason |
|---|---|---|---|
| `index` | `spot-articles.json` | 2026-06-13 | Homepage (`content/index.md`) was intentionally edited post-migration to remove Quartz-era prose (stack description, CI badge, dev command). The Quartz baseline snapshot no longer represents the current homepage content. The other 14 spot pages are unaffected and remain in the baseline. |
