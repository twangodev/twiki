# twiki

Reusable Obsidian-first publishing engine and CLI. Keep user vaults separate from package sources.

- Preserve wikilinks, transclusions, publication policy and authentication boundaries.
- Support plain folders without Git as well as Git repositories and nested submodules.
- Generated state belongs to the consumer project; never modify installed package sources or source notes.
- Run appropriate unit checks and real CLI builds for Cloudflare and static targets before committing.
- Keep independently deployable builds and caching keyed by engine, configuration, renderer and content dependencies.
