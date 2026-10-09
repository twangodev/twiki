# Extraction validation

The first complete Wisconsin CLI build used main at
`9d9fa9d84a730b53f433d4fa3ae8726adf57f676` in a dedicated migration worktree.
Its 1,662 emitted page JSON files were byte-identical to the performance branch
build that was merged into that main revision. Manifest counts, pages, folders,
tags, tree, assets, HTML assets, and graph also matched. All 10 R worksheets
rendered successfully; the cold build completed in 213.12 seconds without restored
product caches. This is extraction parity evidence, not a new CI timing claim.

The plain-vault example passed Cloudflare and static builds. Browser checks of
static output verified navigation, transclusions, Pagefind search, and graph data
with no JavaScript, console, or network errors. Current staged Svelte and Worker
type checks passed. After resolving installed dependency access, the final isolated engine observed 1.09 seconds
to ready, 3.50 seconds to HTML, and 4.27 seconds to hydrated navigation and
graph interaction. Development search correctly reports its missing build-only
Pagefind index; production static search was verified. These observations use
existing caches on a powerful workstation and do not predict CI performance.

The engine unit suite passed 403 tests with four expected R-dependent skips.
Wisconsin checks passed with zero type errors or warnings, 15,810 local link
targets, 67,299 math expressions, and 248 Mermaid diagrams.
The CLI suite also validates generated authentication settings and local preview
origin selection.
History provenance and the complete original-to-replayed commit mapping are in
[history/](history/README.md). Installed-package verification checks a fresh
consumer rather than relying on dependencies from the engine checkout.
A conflicting consumer `esrap@2.4.0` leaves the frozen engine on its verified
`2.2.11` printer; repeated preparation took approximately 38–40 milliseconds
locally and repaired a removed engine dependency. Installed package and vault
bytes remained unchanged through the full Cloudflare build.

Production was not deployed as part of extraction validation. GitHub Actions
results must be assessed separately from these local checks.
