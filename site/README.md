# Wisconsin site

SvelteKit course notes, deployed to Cloudflare Workers at `wisconsin.twango.dev`.

## Development

Run from `site/`:

```sh
bun install --frozen-lockfile
bun run dev:host
```

Course content is stored in Git submodules under `content/` and watched during development.

## Checks

```sh
bun run build:all
bun run check
bun run test
bun run test:e2e
```

Browser tests require Chromium: `bunx playwright install chromium`.

### Validate Math and Mermaid

Run `bun run check:diagrams` to check every Markdown file under `content/`, including untracked, non-ignored notes. To check one course or file, pass its path:

```sh
bun run check:diagrams ../content/fa26-cs577
```

The command checks math with KaTeX and parses and renders Mermaid in Chromium using the installed site versions. Failures include the source file, line, and column and produce a nonzero exit status. Install the browser once with `bunx playwright install chromium`. CI runs the check in the browser-tests job.

This validates recognized Markdown math and Mermaid blocks, not mathematical correctness or visual quality. Unclosed math delimiters can be interpreted as ordinary text by Markdown and need review.
