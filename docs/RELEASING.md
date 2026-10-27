# Releasing @twango/twiki

The `ci.yml` workflow runs checks, deploys the demo, and handles releases.
Release Please maintains a version and changelog PR from Conventional Commits.
Merging that PR creates a GitHub release and tag. After the shared checks pass,
the workflow publishes the release commit to npm through OIDC and builds the
Docker image. Stable npm versions use `latest`; prereleases use `next`.

The manifest starts at `0.1.1`; `bootstrap-sha` excludes the imported history
through that release from the first changelog. Later releases use Release Please's
normal release discovery. The Node strategy updates the root `package.json`;
Bun's root lockfile has no package version field to update.

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
`main` (the workflow ref, even when publication checks out a release commit) and configure
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
3. Watch `release-please`, `publish`, and `docker` in the same workflow.
   Confirm the npm version, dist-tag and provenance before updating consumers.

Enable **Allow GitHub Actions to create and approve pull requests** in repository
Actions settings. Release Please receives GitHub write permissions, npm
publishing receives `id-token: write`, and Docker publishing receives
`packages: write`. The workflow publishes directly from the release commit;
no PAT or npm token is required. If a publishing job fails, rerun it in the
original workflow run to retain the release outputs.

New versions may not be installable immediately after a successful publish. npm
scans packages before exposing them for installation; registry acceptance,
provenance, and consumer installation are separate verification steps.
[Publish-time scanning](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)

## Local release tooling

`bun run release:pack` creates and inspects `dist/twiki.tgz` using
`tooling/release.ts` and `tooling/package.mjs`. When `RELEASE_TAG` and
`RELEASE_SHA` are provided, they must match the checked-out commit and package version.
`bun run release:smoke` installs that archive in a temporary vault, builds both
targets, and checks the installed engine types. It cleans up the vault afterward.

Actions use major version tags, with Dependabot managing version updates.
