# Maintaining documentation

The live site at https://twiki.twango.dev is built from the Obsidian vault in
`documentation/notes`, using `documentation/twiki.config.json`.

Run `bun run docs:dev` for local development. After changing CLI commands or
configuration fields, run `bun run docs:generate` and commit the updated references
and JSON Schema. Edit command definitions in `cli/commands.ts` and config fields in
`site/tooling/lib/project-schema.ts`; generated pages identify their source.

`bun run docs:check` rejects stale generated files, validates configuration examples,
checks documentation links, and exercises CLI examples. Release history is generated
from `CHANGELOG.md` at build time and ignored by Git so Release Please can update it
without a second documentation commit.

CI builds this vault for Cloudflare and static hosting. On main, the deployment job
uploads the validated Cloudflare artifact and checks the live versions. The small
`examples/vault` remains the installed-package smoke-test fixture.
