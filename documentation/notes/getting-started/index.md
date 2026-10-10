---
title: Getting started
---

# Getting started

Twiki requires Bun 1.4+ and Node 22.12+. Git is optional for a plain folder of notes.

In a new directory:

```sh
bun add --dev --exact @twango/twiki
bunx twiki init
```

`init` creates `twiki.config.json` and never overwrites an existing configuration. Its initial publication mode is private. Create an `index.md` file with your home note, then start the development server:

```sh
bunx twiki dev
```

Twiki keeps generated files in `.twiki/`. Add that directory to `.gitignore`. Source notes stay in your vault; the installed engine stays read-only.

For a public site, set `publication` to `public` in the configuration. See [[guides/static-hosting|Static hosting]] or [[guides/cloudflare|Cloudflare deployment]] for the next step. [[reference/configuration|Configuration reference]] explains each field.

To use another directory, pass `--project /path/to/vault`. To change the dev port, use `bunx twiki dev -- --port 5174`.
