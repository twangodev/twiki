# Releasing @twango/twiki

The `release.yml` workflow publishes tags such as `v0.1.1` from commits already
on `main`. The tag must equal the package version. It validates the engine,
CLI, both build targets and the installed npm tarball before publishing those
same bytes. Stable versions use `latest`; prereleases use `next`.

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
release tags (`v*`) and configure required reviewers if desired. Protect `main`
and release tags against unauthorized changes.

Configure the package's trusted publisher with these exact values:

| Field             | Value                             |
| ----------------- | --------------------------------- |
| Provider          | GitHub Actions                    |
| Organization/user | `twangodev`                       |
| Repository        | `twiki`                           |
| Workflow filename | `release.yml`                     |
| Environment       | `npm`                             |
| Allowed action    | Direct publishing (`npm publish`) |

With an authenticated npm 11.21.0 client, the equivalent command is:

```sh
npm trust github @twango/twiki --repository twangodev/twiki --file release.yml --environment npm --allow-publish
npm trust list @twango/twiki
```

The first successful publication must occur within two days of configuring
trust. The workflow uses GitHub-hosted runners, Node 24, npm 11.21.0 and
job-scoped `id-token: write`; it needs no npm token secret. Public-repository
OIDC publication generates provenance. After verifying it works, npm recommends
requiring 2FA and disallowing token-based publishing in the package settings.
[Trusted publishing setup](https://docs.npmjs.com/trusted-publishers/)

## Each release

1. Update the package version and matching locked package metadata. Merge the
   reviewed change to `main`.
2. Create and push the matching tag from that exact commit. For example, after
   the package version is `0.1.1`:

   ```sh
   git tag -a v0.1.1 -m "Release 0.1.1"
   git push origin v0.1.1
   ```

3. Watch both `validate` and `publish` in the Release workflow. Confirm the npm
   version, dist-tag and provenance before updating consumers.

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
