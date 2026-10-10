# twiki

[![npm](https://img.shields.io/npm/v/%40twango%2Ftwiki)](https://www.npmjs.com/package/@twango/twiki)
[![CI](https://img.shields.io/github/actions/workflow/status/twangodev/twiki/ci.yml?branch=main&label=CI)](https://github.com/twangodev/twiki/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/twangodev/twiki)](LICENSE)

Publish Obsidian notes to Cloudflare or a static site.

Requires Bun 1.4+ and Node 22.12+.

```sh
bun add --dev --exact @twango/twiki
bunx twiki init
bunx twiki dev
```

```sh
bunx twiki build --target cloudflare
bunx twiki build --target static
```

[Documentation](docs/usage.md)
