# Releasing twiki

The `release.yml` workflow publishes tags such as `v0.1.0` from commits already
on `main`. The tag must equal the package version. It validates the engine,
CLI, both build targets and the installed npm tarball before publishing those
same bytes. Stable versions use `latest`; prereleases use `next`.

## One-time npm setup

Use an npm account with package write access and account-level 2FA. The package
must already exist before configuring trust. The `npm trust` command requires
npm 11.15.0 or later. [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)

For the initial package only, a maintainer can publish the validated
`0.1.0-rc.0` tarball interactively with `--access public --tag next --provenance=false`. This reserves
the package without assigning a prerelease to `latest`. Version selection and
this initial publication are separate maintainer actions.

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
npm trust github twiki --repository twangodev/twiki --file release.yml --environment npm --allow-publish
npm trust list twiki
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
   the package version is `0.1.0`:

   ```sh
   git tag -a v0.1.0 -m "Release 0.1.0"
   git push origin v0.1.0
   ```

3. Watch both `validate` and `publish` in the Release workflow. Confirm the npm
   version, dist-tag and provenance before updating consumers.

Publishing runs without dependency caches and uses the tarball produced by the
validation job. A hash check binds it to that job; publishing does not rebuild
or execute package lifecycle scripts. No Cloudflare resources are deployed.
