# Releasing @twango/twiki

The single `ci.yml` workflow handles pull request checks, demo deployment and
releases. Release Please runs only on pushes to `main` and
maintains a version/changelog PR using Conventional Commits. Merging that PR
creates a GitHub release and `v<version>` tag, then the same workflow validates
the tagged commit and publishes it through npm OIDC. Ordinary pushes only
update the release PR; they do not publish.

Validation checks the tag, package version, exact commit and ancestry on `main`,
then tests the engine, CLI, both build targets and the installed npm tarball.
The publishing job receives those same bytes. Stable versions use `latest`;
prereleases use `next`.

The manifest starts at `0.1.1`; `bootstrap-sha` excludes the imported history
through that release from the first changelog. Later releases use Release Please's
normal release discovery. The Node strategy updates the root `package.json`;
Bun's root lockfile has no package version field to update.

After the frozen install, `bun audit --audit-level high` blocks release validation
on known high or critical dependency advisories. The gate has no ignored advisories.

## One-time npm setup

Use an npm account with package write access and account-level 2FA. The package
must already exist before configuring trust. The `npm trust` command requires
npm 11.15.0 or later. [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)

For the initial package only, a maintainer can publish the validated
`0.1.0-rc.0` tarball interactively with `--access public --tag next --provenance=false`. This reserves
the package before configuring trust. Verify its dist-tags afterward: the registry
may initialize `latest` for a new package even when `next` was requested. Complete
the stable OIDC publication before directing users to an unversioned install.
Version selection and this initial publication are separate maintainer actions.

Create the GitHub environment `npm`. Restrict its deployment branches/tags to
`main` (the workflow ref, even when validation checks out a tag) and configure
required reviewers if desired. Protect `main`
and release tags against unauthorized changes.

Configure the package's trusted publisher with these exact values:

| Field             | Value                             |
| ----------------- | --------------------------------- |
| Provider          | GitHub Actions                    |
| Organization/user | `twangodev`                       |
| Repository        | `twiki`                           |
| Workflow filename | `ci.yml`                     |
| Environment       | `npm`                             |
| Allowed action    | Direct publishing (`npm publish`) |

With an authenticated npm 11.21.0 client, the equivalent command is:

```sh
npm trust github @twango/twiki --repository twangodev/twiki --file ci.yml --environment npm --allow-publish
npm trust list @twango/twiki
```

The first successful publication must occur within two days of configuring
trust. The workflow uses GitHub-hosted runners, Node 24, npm 11.21.0 and
job-scoped `id-token: write`; it needs no npm token secret. Public-repository
OIDC publication generates provenance. After verifying it works, npm recommends
requiring 2FA and disallowing token-based publishing in the package settings.
[Trusted publishing setup](https://docs.npmjs.com/trusted-publishers/)

## Each release

1. Merge changes with Conventional Commit messages into `main`.
2. Review and merge the Release Please PR containing the version and changelog.
3. Watch `release-please`, `validate` and `publish` in the same Release workflow.
   Confirm the npm version, dist-tag and provenance before updating consumers.

Enable **Allow GitHub Actions to create and approve pull requests** in repository
Actions settings. Only the Release Please job receives GitHub write permissions;
only the publishing job receives `id-token: write`. The default `GITHUB_TOKEN`
is sufficient: publishing continues in the same run rather than relying on a
second workflow triggered by the generated tag. No PAT or npm token is required.
Bot-created release PRs do not automatically trigger other PR workflows with
this token; validation runs after the reviewed release PR merges, before npm
publication. If validation or publishing fails, rerun the failed jobs in the
original workflow run to retain the release outputs; do not move a published tag.

Publishing runs without dependency caches and uses the tarball produced by the
validation job. A hash check binds it to that job; publishing does not rebuild
or execute package lifecycle scripts. No Cloudflare resources are deployed.

## Initial dependency audit

The 0.1.1 frozen engine graph and an independently installed npm tarball passed
the high/critical audit gate on 2026-10-09. Six underlying advisories remain below
that threshold. npm also reports affected dependent packages, so its aggregate
package count is larger than the number of underlying advisories.

| Dependency path | Severity | Advisory |
| --- | --- | --- |
| SvelteKit → cookie 0.6.0 | Low | [Cookie field validation](https://github.com/advisories/GHSA-pxg6-pf52-xh8x) |
| Mermaid/rehype/math → KaTeX 0.16.47 | Low | [Trust bypass after prototype pollution](https://github.com/advisories/GHSA-238p-pmpm-9mq7) |
| Drizzle tooling → esbuild 0.18.20 | Moderate | [Development server access](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| Satori → fflate 0.7.3 | Moderate | [Malformed ZIP64 denial of service](https://github.com/advisories/GHSA-px8p-9vwx-vf98) |
| Tailwind typography → postcss-selector-parser 6.0.10 | Moderate | [Selector parsing denial of service](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |
| js-yaml → argparse → sprintf-js 1.0.3 | Moderate | [Precision parsing denial of service](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) |

Compatible updates were applied without overrides or advisory suppressions.
Remaining updates require upstream dependency changes or separate compatibility
work; sprintf-js had no published fix at the audit date. This inventory does not
establish that every vulnerable code path is unreachable. Re-audit every release.

New versions may not be installable immediately after a successful publish. npm
scans packages before exposing them for installation; registry acceptance,
provenance, and consumer installation are separate verification steps.
[Publish-time scanning](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)
